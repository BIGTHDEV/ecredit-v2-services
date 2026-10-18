/* eslint-env jest */

jest.mock('../config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../services/customerService', () => ({}));
jest.mock('../services/customerLogService', () => ({
  assertActiveCustomer: jest.fn(),
  recordCompanyInfoLookup: jest.fn(),
}));
jest.mock('../services/powerPlatformCompanyInfoService', () => ({
  suggestCompanyInfo: jest.fn(),
}));

const customerController = require('./customerController');
const customerLogService = require('../services/customerLogService');
const companyInfoSuggestionService = require('../services/powerPlatformCompanyInfoService');

describe('customerController.suggestCustomerCompanyInfo', () => {
  const next = jest.fn();

  function createResponse() {
    const res = {
      locals: { correlationId: 'test-correlation-id' },
      setHeader: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    customerLogService.assertActiveCustomer.mockResolvedValue({ ID: 'customer-1' });
    customerLogService.recordCompanyInfoLookup.mockResolvedValue({});
    companyInfoSuggestionService.suggestCompanyInfo.mockResolvedValue({ fields: {}, sources: [] });
  });

  it('rejects malformed Tax IDs before searching', async () => {
    await customerController.suggestCustomerCompanyInfo({
      body: { taxId: '12345' },
      user: { profile: { CODE: 7 } },
      method: 'POST',
      path: '/company-info-suggestions',
    }, createResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'INVALID_TAX_ID' }));
    expect(companyInfoSuggestionService.suggestCompanyInfo).not.toHaveBeenCalled();
  });

  it('rejects users without a numeric employee code', async () => {
    await customerController.suggestCustomerCompanyInfo({
      body: { taxId: '1234567890123' },
      user: { profile: {} },
      method: 'POST',
      path: '/company-info-suggestions',
    }, createResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
    expect(companyInfoSuggestionService.suggestCompanyInfo).not.toHaveBeenCalled();
  });

  it('searches company information and records the outbound payload', async () => {
    const outboundPayload = { Prompt: 'Search prompt', userEmail: 'nuttapongc@bigth.com' };
    companyInfoSuggestionService.suggestCompanyInfo.mockImplementation(async (_taxId, options) => {
      options.onRequestPayload(outboundPayload);
      return { fields: {}, sources: [] };
    });
    const res = createResponse();

    await customerController.suggestCustomerCompanyInfo({
      body: { taxId: '1234567890123' },
      user: {
        email: 'nuttapongc@bigth.com',
        profile: {
          CODE: 7,
          LOGGED_IN_EMAIL: 'nuttapongc@bigth.com',
          LOGGED_IN_INITIALS: 'NUC',
          LOGGED_IN_FULL_NAME: 'Mr. Nuttapong Chaipanya',
        },
      },
      method: 'POST',
      path: '/company-info-suggestions',
    }, res, next);

    expect(companyInfoSuggestionService.suggestCompanyInfo).toHaveBeenCalledWith('1234567890123', {
      userEmail: 'nuttapongc@bigth.com',
      userName: 'NUC (Nuttapong Chaipanya)',
      onRequestPayload: expect.any(Function),
    });
    expect(res.locals.outboundRequests).toEqual([{ system: 'Power Platform', method: 'POST', body: outboundPayload }]);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('no-store'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { fields: {}, sources: [] },
      correlationId: 'test-correlation-id',
    });
    expect(next).not.toHaveBeenCalled();
    expect(customerLogService.recordCompanyInfoLookup).not.toHaveBeenCalled();
  });

  it('records a customer log for a successful lookup on an existing customer', async () => {
    const outboundPayload = { Prompt: 'Search prompt' };
    const result = { fields: { registeredDate: { value: '2020-01-01' } }, sources: [{ url: 'https://example.com' }] };
    companyInfoSuggestionService.suggestCompanyInfo.mockImplementation(async (_taxId, options) => {
      options.onRequestPayload(outboundPayload);
      return result;
    });
    const res = createResponse();

    await customerController.suggestCustomerCompanyInfo({
      body: { taxId: '1234567890123', customerId: 'customer-1' },
      user: { profile: { CODE: 7 } },
      method: 'POST',
      path: '/company-info-suggestions',
    }, res, next);

    expect(customerLogService.assertActiveCustomer).toHaveBeenCalledWith('customer-1');
    expect(customerLogService.recordCompanyInfoLookup).toHaveBeenCalledWith({
      customerId: 'customer-1',
      taxNo: '1234567890123',
      actorId: 7,
      outboundPayload,
      result,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('records a failed lookup and still returns the original error', async () => {
    const failure = Object.assign(new Error('Power Platform unavailable'), { statusCode: 502, code: 'POWERPLATFORM_ERROR' });
    companyInfoSuggestionService.suggestCompanyInfo.mockRejectedValue(failure);

    await customerController.suggestCustomerCompanyInfo({
      body: { taxId: '1234567890123', customerId: 'customer-1' },
      user: { profile: { CODE: 7 } },
      method: 'POST',
      path: '/company-info-suggestions',
    }, createResponse(), next);

    expect(customerLogService.recordCompanyInfoLookup).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'customer-1',
      error: failure,
    }));
    expect(next).toHaveBeenCalledWith(failure);
  });

  it('does not fail the search when the customer log cannot be written', async () => {
    customerLogService.recordCompanyInfoLookup.mockRejectedValue(new Error('DB down'));
    const res = createResponse();

    await customerController.suggestCustomerCompanyInfo({
      body: { taxId: '1234567890123', customerId: 'customer-1' },
      user: { profile: { CODE: 7 } },
      method: 'POST',
      path: '/company-info-suggestions',
    }, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not search for an unknown customer', async () => {
    const notFound = Object.assign(new Error('Customer missing was not found.'), { statusCode: 404 });
    customerLogService.assertActiveCustomer.mockRejectedValue(notFound);

    await customerController.suggestCustomerCompanyInfo({
      body: { taxId: '1234567890123', customerId: 'missing' },
      user: { profile: { CODE: 7 } },
      method: 'POST',
      path: '/company-info-suggestions',
    }, createResponse(), next);

    expect(companyInfoSuggestionService.suggestCompanyInfo).not.toHaveBeenCalled();
    expect(customerLogService.recordCompanyInfoLookup).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(notFound);
  });
});
