/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { getModels } = require('../models');
const customerService = require('../services/customerService');

describe('customerService.getCustomerById date formatting', () => {
  it('displays SQL datetime values without applying the server timezone offset', async () => {
    const customer = {
      ID: 'customer-1',
      UPDATED_DATE: new Date('2026-10-05T12:30:47.987Z'),
      get: jest.fn(() => ''),
    };
    getModels.mockReturnValue({
      Customer: { findOne: jest.fn().mockResolvedValue(customer) },
      Size: {},
      Employee: {},
    });

    const result = await customerService.getCustomerById('customer-1');

    expect(result.UPDATED_DATE).toBe('05 Oct 2026 12:30 PM');
  });

  it('includes Thai/English names and the Sold-To company code', async () => {
    const values = {
      CUSTOMER_NAME_TH: 'บริษัท ตัวอย่าง จำกัด',
      CUSTOMER_NAME_ENG: 'Example Ltd.',
      SOLD_TO: '110000001',
      COMPANY_CODE: '1000 - BIG',
      SALES_GROUP_CODE: '100',
      PHONE: '038994074',
      FAX: '038994075',
      ADDRESS: 'Example address',
    };
    getModels.mockReturnValue({
      Customer: {
        findOne: jest.fn().mockResolvedValue({ ID: 'customer-1', get: jest.fn((key) => values[key] || '') }),
      },
      Size: {},
      Employee: {},
    });
    const result = await customerService.getCustomerById('customer-1');

    expect(result).toEqual(expect.objectContaining({
      CUSTOMER_NAME_TH: 'บริษัท ตัวอย่าง จำกัด',
      CUSTOMER_NAME_ENG: 'Example Ltd.',
      COMPANY_CODE: '1000 - BIG',
      SOLD_TO: '110000001',
      SALES_GROUP: '100 - TGEE',
      PHONE: '038994074',
      FAX: '038994075',
      ADDRESS: 'Example address',
    }));
  });

  it('reads updated master values on each detail load rather than retaining a snapshot', async () => {
    const values = { PHONE: '111', ADDRESS: 'Old address' };
    const findOne = jest.fn().mockImplementation(async () => ({
      ID: 'customer-1', get: (key) => values[key] || '',
    }));
    getModels.mockReturnValue({ Customer: { findOne }, Size: {}, Employee: {} });

    const first = await customerService.getCustomerById('customer-1');
    values.PHONE = '222';
    values.ADDRESS = 'New address';
    const second = await customerService.getCustomerById('customer-1');

    expect(first).toEqual(expect.objectContaining({ PHONE: '111', ADDRESS: 'Old address' }));
    expect(second).toEqual(expect.objectContaining({ PHONE: '222', ADDRESS: 'New address' }));
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('returns empty company information when the live master has no company value', async () => {
    getModels.mockReturnValue({
      Customer: {
        findOne: jest.fn().mockResolvedValue({ ID: 'customer-1', get: jest.fn((key) => (key === 'SOLD_TO' ? '110000001' : '')) }),
      },
      Size: {},
      Employee: {},
    });
    const result = await customerService.getCustomerById('customer-1');

    expect(result.COMPANY_CODE).toBe('');
  });
});
