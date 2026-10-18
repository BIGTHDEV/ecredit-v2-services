/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));

const { getModels } = require('../models');
const customerLogService = require('../services/customerLogService');

describe('customerLogService', () => {
  let Customer;
  let CustomerLog;

  beforeEach(() => {
    Customer = { findOne: jest.fn().mockResolvedValue({ ID: 'customer-1', TAX_NO: '1234567890123' }) };
    CustomerLog = {
      create: jest.fn().mockResolvedValue(undefined),
      findAndCountAll: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
      findOne: jest.fn(),
      sequelize: { fn: jest.fn((name) => ({ fn: name })) },
    };
    getModels.mockReturnValue({ Customer, CustomerLog, Employee: {}, LogType: {} });
  });

  it('records Find Company Data lookups with the outbound payload and result', async () => {
    const result = { fields: { registeredDate: { value: '2020-01-01' } }, sources: [{ url: 'https://example.com' }] };

    await customerLogService.recordCompanyInfoLookup({
      customerId: 'customer-1',
      taxNo: '1234567890123',
      actorId: 7,
      outboundPayload: { Prompt: 'Search prompt' },
      result,
    });

    const record = CustomerLog.create.mock.calls[0][0];
    expect(record).toEqual(expect.objectContaining({
      CUSTOMER_ID: 'customer-1',
      TAX_NO: '1234567890123',
      NAME: 'Company data searched',
      CATEGORY: 'customer.company-info-lookup',
      LOG_TYPE_ID: '23556cea-337f-475c-9b6a-830bfa08ab93',
      CREATED_BY: 7,
    }));
    expect(JSON.parse(record.DESCRIPTION)).toEqual(expect.objectContaining({
      action: 'lookup',
      source: 'Find Company Data',
      status: 'success',
      request: { Prompt: 'Search prompt' },
      response: result,
    }));
  });

  it('records failed Find Company Data lookups as errors', async () => {
    await customerLogService.recordCompanyInfoLookup({
      customerId: 'customer-1',
      taxNo: '1234567890123',
      actorId: 7,
      error: Object.assign(new Error('Power Platform unavailable'), { code: 'POWERPLATFORM_ERROR' }),
    });

    const record = CustomerLog.create.mock.calls[0][0];
    expect(record.NAME).toBe('Company data search failed');
    expect(record.LOG_TYPE_ID).toBe('2d8e6e9d-0b7b-427f-a5ba-0e65f61d945b');
    expect(JSON.parse(record.DESCRIPTION)).toEqual(expect.objectContaining({
      status: 'failed',
      error: { code: 'POWERPLATFORM_ERROR', message: 'Power Platform unavailable' },
    }));
  });

  it('lists enabled logs for the active customer with bounded pagination', async () => {
    const result = await customerLogService.listCustomerLogs('customer-1', {
      page: '2',
      pageSize: '500',
      search: 'audit',
    });

    expect(CustomerLog.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        CUSTOMER_ID: 'customer-1',
        ENABLED: true,
      }),
      limit: 100,
      offset: 100,
    }));
    expect(result.pagination).toEqual({ page: 2, pageSize: 100, totalItems: 0, totalPages: 1 });
  });

  it('does not query logs when the customer is missing or disabled', async () => {
    Customer.findOne.mockResolvedValue(null);

    await expect(customerLogService.listCustomerLogs('customer-1', {}))
      .rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });

    expect(CustomerLog.findAndCountAll).not.toHaveBeenCalled();
  });

  it('maps log metadata and the creating employee for the list', async () => {
    CustomerLog.findAndCountAll.mockResolvedValue({
      count: 1,
      rows: [{
        get: () => ({
          ID: 'log-1',
          TAX_NO: '1234567890123',
          DESCRIPTION: JSON.stringify({
            action: 'update',
            source: 'all-requests.details.submit',
            values: { REGISTERED_CAPITAL_AMOUNT: '1000000' },
          }),
          CREATED_DATE: new Date('2026-10-05T12:30:00.000Z'),
          CREATED_BY: 42,
          createdByEmployee: { INITIALS: 'NC', USERNAME: 'NUTTAPONG' },
        }),
      }],
    });

    const result = await customerLogService.listCustomerLogs('customer-1', {});

    expect(result.items[0]).toEqual({
      id: 'log-1',
      taxNo: '1234567890123',
      action: 'update',
      source: 'all-requests.details.submit',
      createdDate: '2026-10-05T12:30:00.000+07:00',
      createdBy: 42,
      actor: 'NC-NUTTAPONG',
    });
  });

  it('only returns a log belonging to the requested customer', async () => {
    CustomerLog.findOne.mockResolvedValue(null);

    await expect(customerLogService.getCustomerLog('customer-1', 'log-1'))
      .rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });

    expect(CustomerLog.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ID: 'log-1',
        CUSTOMER_ID: 'customer-1',
        ENABLED: true,
      }),
    }));
  });

  it('rejects searches longer than 100 characters', async () => {
    await expect(customerLogService.listCustomerLogs('customer-1', { search: 'x'.repeat(101) }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });

    expect(CustomerLog.findAndCountAll).not.toHaveBeenCalled();
  });

  it('stores a full customer snapshot and before/after JSON in the log description', async () => {
    const before = {
      ID: 'customer-1',
      TAX_NO: '1234567890123',
      REGISTERED_CAPITAL_AMOUNT: '1000000',
      ENABLED: '1',
    };
    const after = {
      ...before,
      REGISTERED_CAPITAL_AMOUNT: '2000000',
      DIRECTORS: 'New director',
    };

    await customerLogService.recordCustomerMutation({
      customerId: 'customer-1',
      taxNo: '1234567890123',
      action: 'update',
      source: 'customer-extensions.details.save',
      actorId: 42,
      before,
      after,
      transaction: {},
    });

    const [log, options] = CustomerLog.create.mock.calls[0];
    expect(log).toEqual(expect.objectContaining({
      TAX_NO: '1234567890123',
      NAME: 'Customer updated',
      LOG_TYPE_ID: expect.any(String),
      CUSTOMER_ID: 'customer-1',
      CATEGORY: 'customer.update',
      CREATED_BY: 42,
      UPDATED_BY: 42,
      ENABLED: true,
    }));
    expect(log).not.toHaveProperty('REGISTERED_CAPITAL_AMOUNT');
    expect(log).not.toHaveProperty('DIRECTORS');
    expect(JSON.parse(log.DESCRIPTION)).toMatchObject({
      operation: 'upsert',
      action: 'update',
      source: 'customer-extensions.details.save',
      customerId: 'customer-1',
      values: {
        REGISTERED_CAPITAL_AMOUNT: '2000000',
        DIRECTORS: 'New director',
      },
      changes: {
        REGISTERED_CAPITAL_AMOUNT: { from: '1000000', to: '2000000' },
        DIRECTORS: { from: null, to: 'New director' },
      },
    });
    expect(options).toEqual({ transaction: {} });
  });
});
