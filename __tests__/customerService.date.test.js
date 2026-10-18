/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../services/requestService', () => ({ getCompanyCode: jest.fn().mockResolvedValue('') }));

const { getModels } = require('../models');
const requestService = require('../services/requestService');
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
    };
    getModels.mockReturnValue({
      Customer: {
        findOne: jest.fn().mockResolvedValue({ ID: 'customer-1', get: jest.fn((key) => values[key] || '') }),
      },
      Size: {},
      Employee: {},
    });
    requestService.getCompanyCode.mockResolvedValue('1000 - BIG');

    const result = await customerService.getCustomerById('customer-1');

    expect(requestService.getCompanyCode).toHaveBeenCalledWith('110000001');
    expect(result).toEqual(expect.objectContaining({
      CUSTOMER_NAME_TH: 'บริษัท ตัวอย่าง จำกัด',
      CUSTOMER_NAME_ENG: 'Example Ltd.',
      COMPANY_CODE: '1000 - BIG',
    }));
  });

  it('keeps the customer readable when the company code lookup fails', async () => {
    getModels.mockReturnValue({
      Customer: {
        findOne: jest.fn().mockResolvedValue({ ID: 'customer-1', get: jest.fn((key) => (key === 'SOLD_TO' ? '110000001' : '')) }),
      },
      Size: {},
      Employee: {},
    });
    requestService.getCompanyCode.mockRejectedValue(new Error('MDCENTER unavailable'));

    const result = await customerService.getCustomerById('customer-1');

    expect(result.COMPANY_CODE).toBe('');
  });
});
