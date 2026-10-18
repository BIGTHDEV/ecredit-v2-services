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

    expect(Customer.sequelize.query).toHaveBeenCalledWith(expect.stringContaining('SALE_GROUP = :salesGroup'), {
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
  });

  it('requires a valid Sales Group before searching Sold-To customers', async () => {
    await expect(customerService.searchSoldToCustomers('Example', ''))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(Customer.sequelize.query).not.toHaveBeenCalled();
  });
});
