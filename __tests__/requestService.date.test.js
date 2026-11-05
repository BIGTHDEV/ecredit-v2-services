/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../services/attachmentService', () => ({}));

const { getModels } = require('../models');
const { getDatabase } = require('../config/database');
const requestService = require('../services/requestService');

describe('requestService.getCompanyCode Salesforce lookup', () => {
  let query;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([{ COMP_CODE: '1000', DESCRIPTION: 'BIG' }]);
    getDatabase.mockReturnValue({ query });
  });

  it('uses the account ID instead of an ambiguous Sold-To number', async () => {
    await expect(requestService.getCompanyCode('110000001', '001000000000001AAA')).resolves.toBe('1000 - BIG');
    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain('FROM S_SalesforceAccount SC');
    expect(sql).toContain('SC.Id COLLATE DATABASE_DEFAULT = :soldId COLLATE DATABASE_DEFAULT');
    expect(sql).not.toContain('WHERE SC.Sold_to_No__c');
    expect(sql).toContain('SC.Company_Code__c COLLATE DATABASE_DEFAULT = TB2.Comp_Code COLLATE DATABASE_DEFAULT');
    expect(options.replacements.soldId).toBe('001000000000001AAA');
  });

  it('falls back to the Sold-To number only when there is no account ID', async () => {
    await requestService.getCompanyCode('110000001');
    expect(query.mock.calls[0][0]).toContain('SC.Sold_to_No__c COLLATE DATABASE_DEFAULT = :soldTo COLLATE DATABASE_DEFAULT');
  });

  it('does not retry a missing account using another customer number', async () => {
    query.mockResolvedValue([]);
    await expect(requestService.getCompanyCode('110000001', '001000000000001AAA')).resolves.toBe('');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not query without either key', async () => {
    await expect(requestService.getCompanyCode('')).resolves.toBe('');
    expect(query).not.toHaveBeenCalled();
  });
});

describe('requestService.getRequestById date formatting', () => {
  it('displays SQL datetime values without applying the server timezone offset', async () => {
    const request = new Proxy({
      ID: 'request-1',
      CUSTOMER_TAX_NO: '-',
      SOLD_TO: '',
      UPDATED_DATE: new Date('2026-10-05T12:30:47.987Z'),
    }, {
      get(target, property, receiver) {
        return Reflect.has(target, property) ? Reflect.get(target, property, receiver) : '';
      },
    });
    getModels.mockReturnValue({
      Request: { findOne: jest.fn().mockResolvedValue(request) },
      Rating: {},
      Term: {},
      Status: {},
      Employee: {},
    });

    const result = await requestService.getRequestById('request-1');

    expect(result.UPDATED_DATE).toBe('05 Oct 2026 12:30 PM');
  });
});
