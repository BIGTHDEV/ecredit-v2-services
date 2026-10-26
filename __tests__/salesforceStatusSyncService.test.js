/* eslint-env jest */

jest.mock('../config/env', () => ({
  crm: {
    baseUrl: 'https://crm.example.com/services',
    grantType: 'password',
    clientId: 'client-id-test',
    clientSecret: 'client-secret-test',
    username: 'crm-user-test',
    password: 'crm-password-test',
  },
}));
jest.mock('../models', () => {
  const models = { Request: { findOne: jest.fn() } };
  return { getModels: jest.fn(() => models) };
});
jest.mock('../services/eventLogService', () => ({ recordSalesforceEndpointEvent: jest.fn() }));

const { getModels } = require('../models');
const { recordSalesforceEndpointEvent } = require('../services/eventLogService');
const { CRM_STATUS_CODES, syncRequestStatus, checkReadiness } = require('../services/salesforceStatusSyncService');

describe('salesforceStatusSyncService', () => {
  const request = {
    CRM_ID: 'crm-credit-id',
    APPROVED_LIMIT_AMOUNT: null,
    APPROVED_TERM_ID: null,
    APPROVED_RATING_ID: 'rating-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getModels().Request.findOne.mockResolvedValue(request);
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'token-secret', token_type: 'Bearer' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ Success: true, ErrMsg: '200' }) });
  });

  afterEach(() => {
    delete global.fetch;
  });

  test.each([
    ['31d531f4-0420-4db5-aecf-bcfe4a0e8c4a', '100000004'],
    ['407e23f9-caf5-4c4a-801d-598cf437d1ae', '100000001'],
    ['94589a22-12e5-4298-aa30-06295acbe1b9', '100000003'],
  ])('maps eCredit status %s to Salesforce code %s', async (statusId, crmStatus) => {
    expect(CRM_STATUS_CODES.get(statusId)).toBe(crmStatus);
    const eventContext = { correlationId: 'correlation-1', actorCode: 12345 };
    await expect(syncRequestStatus('request-1', statusId, eventContext)).resolves.toEqual({ success: true });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenOptions] = global.fetch.mock.calls[0];
    expect(tokenUrl).toBe('https://crm.example.com/services/oauth2/token');
    expect(tokenOptions.body).toContain('grant_type=password');
    expect(tokenOptions.body).not.toContain('token-secret');
    expect(tokenUrl).not.toContain('client-secret-test');

    const [updateUrl, updateOptions] = global.fetch.mock.calls[1];
    expect(updateUrl).toContain('/services/apexrest/Update_Credit_Rating_Credit_Limit/');
    expect(updateOptions.headers.authorization).toBe('Bearer token-secret');
    expect(updateOptions.headers['content-type']).toBe('application/json');
    const credit = JSON.parse(updateOptions.body).credit;
    expect(credit).toEqual({
      credit_id: 'crm-credit-id',
      credit_status: crmStatus,
      credit_limit: 0,
      terms: '',
      rating: 'rating-id',
    });
    expect(recordSalesforceEndpointEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      ...eventContext,
      requestId: 'request-1',
      endpoint: 'oauth2/token', success: true, httpStatus: 200,
      response: { token_type: 'Bearer' },
    }));
    expect(recordSalesforceEndpointEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      ...eventContext,
      requestId: 'request-1',
      endpoint: expect.stringContaining('apexrest/'), success: true, httpStatus: 200,
    }));
    expect(JSON.stringify(recordSalesforceEndpointEvent.mock.calls)).not.toContain('token-secret');
    expect(JSON.stringify(recordSalesforceEndpointEvent.mock.calls)).not.toContain('client-secret-test');
    expect(JSON.stringify(recordSalesforceEndpointEvent.mock.calls)).not.toContain('signature');
  });

  test('treats Salesforce Success false as a sync failure and logs the update result', async () => {
    global.fetch.mockReset()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'token-secret', token_type: 'Bearer' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({
        Success: false, ErrMsg: 'Rejected token-secret client-secret-test',
      }) });

    await expect(syncRequestStatus('request-1', '407e23f9-caf5-4c4a-801d-598cf437d1ae'))
      .rejects.toThrow('Rejected [REDACTED] [REDACTED]');
    expect(recordSalesforceEndpointEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      requestId: 'request-1',
      endpoint: expect.stringContaining('apexrest/'),
      success: false,
      httpStatus: 200,
      message: 'Rejected [REDACTED] [REDACTED]',
      response: { Success: false, ErrMsg: 'Rejected [REDACTED] [REDACTED]' },
    }));
    expect(JSON.stringify(recordSalesforceEndpointEvent.mock.calls)).not.toContain('token-secret');
    expect(JSON.stringify(recordSalesforceEndpointEvent.mock.calls)).not.toContain('client-secret-test');
  });

  test('does not call Salesforce for unrelated statuses', async () => {
    await expect(syncRequestStatus('request-1', 'draft-status')).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(recordSalesforceEndpointEvent).not.toHaveBeenCalled();
  });

  test('checks readiness using only OAuth without logging, querying requests or returning tokens', async () => {
    await expect(checkReadiness()).resolves.toEqual({ ready: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://crm.example.com/services/oauth2/token');
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(getModels().Request.findOne).not.toHaveBeenCalled();
    expect(recordSalesforceEndpointEvent).not.toHaveBeenCalled();
  });

  test.each([
    { ok: false, status: 401, payload: { error: 'invalid_grant', error_description: 'private CRM details' } },
    { ok: true, status: 200, payload: {} },
    { ok: true, status: 200, payload: { access_token: ' ' } },
  ])('returns only not-ready for rejected or invalid OAuth responses: %j', async ({ ok, status, payload }) => {
    global.fetch.mockReset().mockResolvedValue({ ok, status, text: async () => JSON.stringify(payload) });
    await expect(checkReadiness()).resolves.toEqual({ ready: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(recordSalesforceEndpointEvent).not.toHaveBeenCalled();
  });

  test('does not log network failures or timeouts during readiness checks', async () => {
    global.fetch.mockReset().mockRejectedValue(new Error('Request timed out'));
    await expect(checkReadiness()).resolves.toEqual({ ready: false });
    expect(recordSalesforceEndpointEvent).not.toHaveBeenCalled();
  });
});
