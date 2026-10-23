/* eslint-env jest */

jest.mock('../config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../services/requestService', () => ({
  getRequestById: jest.fn(),
  cancelRequest: jest.fn(),
}));
jest.mock('../services/powerPlatformCompanyInfoService', () => ({
  suggestCompanyInfo: jest.fn(),
}));
jest.mock('../services/requestEmailModelService', () => ({
  getRequestEmailModel: jest.fn(),
}));
jest.mock('../emails/requestCompletedEmail', () => ({
  sendRequestCompletedEmail: jest.fn(),
}));
jest.mock('../services/requestWorkflowNotificationService', () => ({
  notifyBestEffort: jest.fn(),
}));
jest.mock('../services/salesforceStatusSyncService', () => ({ syncRequestStatusSafely: jest.fn() }));
jest.mock('../helpers/roleAuthorization', () => ({
  isSystemAdminRole: jest.fn(() => false),
}));
jest.mock('../helpers/userIdentity', () => ({
  effectiveEmployeeCode: jest.fn(() => 7),
  approvalAuditEmployeeCode: jest.fn(() => 7),
}));

const requestController = require('./requestController');
const requestService = require('../services/requestService');
const companyInfoSuggestionService = require('../services/powerPlatformCompanyInfoService');
const { syncRequestStatusSafely } = require('../services/salesforceStatusSyncService');

describe('requestController.cancelRequest CRM synchronization', () => {
  it('syncs the cancelled status after eCredit commits', async () => {
    requestService.cancelRequest.mockResolvedValue(true);
    syncRequestStatusSafely.mockResolvedValue({ success: false, message: 'CRM unavailable' });
    const res = {
      locals: { correlationId: 'test-correlation-id' },
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await requestController.cancelRequest({
      params: { id: 'request-id' },
      body: { cancelledNotes: 'Duplicate request' },
      user: { profile: { EFFECTIVE_CODE: '7', EMAIL: 'user@example.com' } },
    }, res, next);

    expect(syncRequestStatusSafely).toHaveBeenCalledWith(
      'request-id', '31d531f4-0420-4db5-aecf-bcfe4a0e8c4a',
      { correlationId: 'test-correlation-id', actorCode: 7 },
    );
    expect(res.json.mock.calls[0][0].crmSync).toMatchObject({ success: false });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requestController.suggestRequestCustomerInfo', () => {
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
    syncRequestStatusSafely.mockResolvedValue(null);
    requestService.getRequestById.mockResolvedValue({
      STATUS: 'Draft',
      REQUESTED_BY: 7,
      SUBMITTED_BY: 7,
    });
    companyInfoSuggestionService.suggestCompanyInfo.mockResolvedValue({
      fields: {},
      sources: [],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects malformed Tax IDs before looking up request data', async () => {
    const res = createResponse();
    await requestController.suggestRequestCustomerInfo({
      body: { taxId: '1234' },
      params: { id: 'request-id' },
      user: { profile: {} },
      method: 'POST',
      path: '/request-id/customer-info-suggestions',
    }, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      code: 'INVALID_TAX_ID',
    }));
    expect(requestService.getRequestById).not.toHaveBeenCalled();
    expect(companyInfoSuggestionService.suggestCompanyInfo).not.toHaveBeenCalled();
  });

  it('allows a request participant to search only a draft request', async () => {
    const res = createResponse();
    const outboundPayload = {
      Prompt: 'Search prompt',
      userEmail: 'nuttapongc@bigth.com',
      userName: 'NUC-NUTTAPONGC',
      Application: 'eCredit',
      Module: 'Main',
      Remark: 'DEV|Company information lookup by Tax ID',
    };
    companyInfoSuggestionService.suggestCompanyInfo.mockImplementation(async (_taxId, options) => {
      options.onRequestPayload(outboundPayload);
      return { fields: {}, sources: [] };
    });
    await requestController.suggestRequestCustomerInfo({
      body: { taxId: '1234567890123' },
      params: { id: 'request-id' },
      user: {
        email: 'nuttapongc@bigth.com',
        profile: {
          LOGGED_IN_EMAIL: 'nuttapongc@bigth.com',
          LOGGED_IN_USERNAME: 'NUC-NUTTAPONGC',
          LOGGED_IN_INITIALS: 'NUC',
          LOGGED_IN_FULL_NAME: 'Mr. Nuttapong Chaipanya',
        },
      },
      method: 'POST',
      path: '/request-id/customer-info-suggestions',
    }, res, next);

    expect(companyInfoSuggestionService.suggestCompanyInfo).toHaveBeenCalledWith('1234567890123', {
      userEmail: 'nuttapongc@bigth.com',
      userName: 'NUC (Nuttapong Chaipanya)',
      onRequestPayload: expect.any(Function),
    });
    expect(res.locals.outboundRequests).toEqual([{
      system: 'Power Platform',
      method: 'POST',
      body: outboundPayload,
    }]);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('no-store'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('denies searches for non-draft requests', async () => {
    requestService.getRequestById.mockResolvedValue({
      STATUS: 'Submitted',
      REQUESTED_BY: 7,
      SUBMITTED_BY: 7,
    });
    const res = createResponse();
    await requestController.suggestRequestCustomerInfo({
      body: { taxId: '1234567890123' },
      params: { id: 'request-id' },
      user: {
        email: 'nuttapongc@bigth.com',
        profile: {
          LOGGED_IN_EMAIL: 'nuttapongc@bigth.com',
          LOGGED_IN_USERNAME: 'NUC-NUTTAPONGC',
        },
      },
      method: 'POST',
      path: '/request-id/customer-info-suggestions',
    }, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      code: 'FORBIDDEN',
    }));
    expect(companyInfoSuggestionService.suggestCompanyInfo).not.toHaveBeenCalled();
  });
});
