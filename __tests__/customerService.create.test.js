/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));

const { getModels } = require('../models');
const customerService = require('../services/customerService');

describe('customerService Customer Extensions creation', () => {
  let Customer;
  let CustomerLog;
  let transaction;

  beforeEach(() => {
    jest.clearAllMocks();
    transaction = {
      LOCK: { UPDATE: 'UPDATE' },
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      finished: false,
    };
    const createdCustomer = {
      ID: 'new-customer',
      TAX_NO: '1234567890123',
      ENABLED: '1',
      get: jest.fn(() => ({
        ID: 'new-customer',
        TAX_NO: '1234567890123',
        ENABLED: '1',
        REGISTERED_CAPITAL_AMOUNT: null,
        SIZE_ID: 'small-size',
      })),
    };
    Customer = {
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createdCustomer),
      create: jest.fn().mockResolvedValue(createdCustomer),
      sequelize: {
        fn: jest.fn((name, ...args) => ({ fn: name, args })),
        transaction: jest.fn().mockResolvedValue(transaction),
        query: jest.fn(),
      },
    };
    CustomerLog = {
      create: jest.fn().mockResolvedValue(undefined),
      sequelize: Customer.sequelize,
    };
    getModels.mockReturnValue({
      Customer,
      CustomerLog,
      Size: { findOne: jest.fn().mockResolvedValue({ ID: 'small-size' }) },
      Employee: {},
    });
  });

  it('creates and audits a customer extension using the existing fields', async () => {
    const result = await customerService.createCustomer({
      TAX_NO: '1234567890123',
      SIZE_ID: 'small-size',
      REGISTERED_DATE: '2026-10-12',
    }, 123);

    expect(result.id).toBe('new-customer');
    expect(Customer.create).toHaveBeenCalledWith(expect.objectContaining({
      ID: expect.any(String),
      TAX_NO: '1234567890123',
      REGISTERED_DATE: { fn: 'DATEFROMPARTS', args: [2026, 10, 12] },
      ENABLED: '1',
      CREATED_DATE: { fn: 'GETDATE', args: [] },
      CREATED_BY: 123,
      UPDATED_DATE: { fn: 'GETDATE', args: [] },
      UPDATED_BY: 123,
    }), { transaction });
    expect(CustomerLog.create).toHaveBeenCalledWith(expect.objectContaining({
      TAX_NO: '1234567890123',
      NAME: 'Customer created',
      CUSTOMER_ID: expect.any(String),
      CATEGORY: 'customer.insert',
      CREATED_BY: 123,
    }), { transaction });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('ignores a supplied account ID and creates the extension using only its Tax ID', async () => {
    await customerService.createCustomer({ TAX_NO: '1234567890123', SOLD_ID: '001000000000001AAA' }, 123);

    expect(Customer.create).toHaveBeenCalledWith(expect.objectContaining({ TAX_NO: '1234567890123' }), { transaction });
    expect(Customer.create.mock.calls[0][0]).not.toHaveProperty('SOLD_ID');
    expect(Customer.sequelize.query).not.toHaveBeenCalled();
    const audit = JSON.parse(CustomerLog.create.mock.calls[0][0].DESCRIPTION);
    expect(audit.changes).not.toHaveProperty('SOLD_ID');
  });

  it('does not persist Basic Information supplied in a customer payload', async () => {
    const basicInformation = {
      SOLD_TO: '110000336', SALES_GROUP_CODE: '100', COMPANY_CODE: '1000 - BIG',
      CUSTOMER_NAME_TH: 'Local name', CUSTOMER_NAME_ENG: 'Example Ltd.',
      PHONE: '038994074', FAX: '038994075', ADDRESS: 'Example address',
    };

    await customerService.createCustomer({ TAX_NO: '1234567890123', ...basicInformation }, 123);

    const saved = Customer.create.mock.calls[0][0];
    Object.keys(basicInformation).forEach((field) => expect(saved).not.toHaveProperty(field));
    expect(saved.TAX_NO).toBe('1234567890123');
  });

  it('rejects any existing TAX_NO without creating a row', async () => {
    Customer.findOne.mockReset().mockResolvedValue({ ID: 'existing-customer' });

    await expect(customerService.createCustomer({ TAX_NO: '1234567890123' }, 123))
      .rejects.toMatchObject({ statusCode: 409, code: 'RESOURCE_CONFLICT' });

    expect(Customer.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { TAX_NO: '1234567890123' },
    }));
    expect(Customer.create).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('checks for a Tax ID across all Customer Extension records', async () => {
    Customer.findOne.mockReset().mockResolvedValue({ ID: 'existing-customer' });

    await expect(customerService.customerTaxNoExists('1234567890123')).resolves.toBe(true);

    expect(Customer.findOne).toHaveBeenCalledWith({
      where: { TAX_NO: '1234567890123' },
      attributes: ['ID'],
    });
  });

  it('searches Sold-To records using parameterized input and maps CRM fields', async () => {
    Customer.sequelize.query.mockResolvedValue([{
      SOLDTO_NO: '110000001',
      SOLDTO_NAME_ENG: 'Example Ltd.',
      SOLDTO_NAME_THAI: 'บริษัท ตัวอย่าง จำกัด  ',
      CUST_PHONE: '123',
      CUST_FAX: '456',
      ADDRESS_ENG_SOLDTO: 'Example address',
      TAX_NO: '1234567890123',
      COMPANY_CODE: '1000',
      COMPANY_NAME: 'BIG',
    }]);

    const results = await customerService.searchSoldToCustomers('Example', '100');

    expect(Customer.sequelize.query).toHaveBeenCalledWith(expect.stringContaining('SG.Sales_Group__c COLLATE DATABASE_DEFAULT = :salesGroup COLLATE DATABASE_DEFAULT'), {
      replacements: { salesGroup: '100', search: '%Example%' },
      type: expect.anything(),
    });
    expect(results[0]).toEqual({
      SOLDTO_NO: '110000001',
      SOLDTO_NAME_ENG: 'Example Ltd.',
      SOLDTO_NAME_TH: 'บริษัท ตัวอย่าง จำกัด',
      COMPANY_CODE: '1000 - BIG',
      CUST_PHONE: '123',
      CUST_FAX: '456',
      ADDRESS_ENG_SOLDTO: 'Example address',
      TAX_NO: '1234567890123',
    });
    const sql = Customer.sequelize.query.mock.calls[0][0];
    expect(sql).toContain('FROM dbo.S_SalesforceAccount AS SC');
    expect(sql).toContain("WHERE SC.RecordTypeName = N'Customer Sold-To Read Only'");
    expect(sql.replace(/\s+/g, ' ')).toContain("AND SC.Id IN ( SELECT SO.Id FROM dbo.S_SalesforceAccount AS SO WHERE SO.RecordTypeName = N'Customer Sold-To Read Only' AND SO.Sold_to_No__c IN ( SELECT SG.Sold_to_No__c FROM dbo.S_SalesforceAccount AS SG WHERE SG.Sales_Group__c COLLATE DATABASE_DEFAULT = :salesGroup COLLATE DATABASE_DEFAULT ) )");
    expect(sql).not.toContain('SC.Sales_Group__c');
    expect(sql).not.toContain('SO.Sales_Group__c');
    expect(sql).not.toContain('SG.RecordTypeName');
    expect(sql.trim()).toMatch(/ORDER BY SC\.Id$/);
    expect(sql).toContain('LEFT JOIN S_CompanyMaster TB2');
    expect(sql).toContain('SC.Company_Code__c COLLATE DATABASE_DEFAULT = TB2.Comp_Code COLLATE DATABASE_DEFAULT');
    expect(sql).toContain('SC.Sub_District_EN_r_Name__c');
    expect(sql).not.toContain('S_vw_CustomerShipTo');
  });

  it.each(['100', '200', '300', '999'])('binds selected Sales Group %s to the Sold-To-number subquery', async (salesGroup) => {
    Customer.sequelize.query.mockResolvedValue([]);

    await customerService.searchSoldToCustomers('11', salesGroup);

    const [sql, options] = Customer.sequelize.query.mock.calls[0];
    expect(sql).toContain('AND SC.Id IN (');
    expect(sql).toContain('AND SO.Sold_to_No__c IN (');
    expect(sql).toContain('SELECT SG.Sold_to_No__c');
    expect(sql).toContain('SG.Sales_Group__c COLLATE DATABASE_DEFAULT = :salesGroup COLLATE DATABASE_DEFAULT');
    expect(options.replacements).toEqual({ salesGroup, search: '%11%' });
  });

  it('lists customers without nested account-ID lookups or ID-based snapshot filtering', async () => {
    Customer.findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 60 });

    const result = await customerService.listCustomers({ page: 2, pageSize: 25 });

    const options = Customer.findAndCountAll.mock.calls[0][0];
    const attributes = Object.fromEntries(options.attributes.include.map(([expression, name]) => [name, expression.val]));
    const sql = Object.values(attributes).join('\n');
    expect(sql).not.toContain('SOLD_ID');
    expect(sql).not.toContain('RecordTypeName');
    expect(sql).not.toContain('COALESCE(\n  NULLIF(LTRIM(RTRIM(Customer.');
    expect(attributes.CUSTOMER_NAME).not.toContain('FROM REQUESTS');
    expect(sql).not.toContain('FROM REQUESTS');
    expect(options).toEqual(expect.objectContaining({ offset: 25, limit: 25 }));
    expect(result.pagination).toEqual({ page: 2, pageSize: 25, totalItems: 60, totalPages: 3 });
  });

  it('reads all Basic Information live by Tax ID without depending on request snapshots', async () => {
    await customerService.getCustomerById('new-customer');

    const options = Customer.findOne.mock.calls[0][0];
    const attributes = Object.fromEntries(options.attributes.include.map(([expression, name]) => [name, expression.val]));
    expect(attributes.CUSTOMER_NAME).toContain('FROM S_SalesforceAccount SC');
    expect(attributes.CUSTOMER_NAME).toContain('SC.Tax_Id__c = CONVERT(nvarchar(255), Customer.TAX_NO) COLLATE SQL_Latin1_General_CP1_CI_AS');
    expect(Object.values(attributes).join('\n')).not.toContain('SOLD_ID');
    expect(attributes.SOLD_TO).toContain('SC.Sold_to_No__c');
    expect(attributes.CUSTOMER_NAME).toContain('ORDER BY LEN(SC.Name) ASC, SC.Name ASC, SC.Id ASC');
    expect(attributes.CUSTOMER_NAME_TH).toContain('SC.NameLocal');
    expect(attributes.CUSTOMER_NAME_ENG).toContain('SC.Name');
    expect(attributes.CUSTOMER_NAME_ENG).not.toContain('S_CUSTOMER');
    expect(attributes.SALES_GROUP_CODE).toContain('SC.Sales_Group__c');
    expect(attributes.PHONE).toContain('SC.Phone');
    expect(attributes.FAX).toContain('SC.Fax');
    expect(attributes.ADDRESS).toContain('SC.Sub_District_EN_r_Name__c');
    expect(attributes.COMPANY_CODE).toContain('LEFT JOIN S_CompanyMaster');
    expect(attributes.COMPANY_CODE).toContain('TB2.Description');
    Object.values(attributes).forEach((sql) => {
      expect(sql).toContain('FROM S_SalesforceAccount SC');
      expect(sql).toContain('ORDER BY LEN(SC.Name) ASC, SC.Name ASC, SC.Id ASC');
      expect(sql).not.toContain('REQUESTS');
    });
  });

  it('requires a valid Sales Group before searching Sold-To customers', async () => {
    await expect(customerService.searchSoldToCustomers('Example', ''))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(Customer.sequelize.query).not.toHaveBeenCalled();
  });
});
