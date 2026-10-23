/* eslint-env jest */

jest.mock('../services/requestService', () => ({
  changeRequestStatus: jest.fn(),
  submitRequest: jest.fn(),
  processApprovalAction: jest.fn(),
}));
jest.mock('../services/salesforceStatusSyncService', () => ({
  CRM_STATUS_CODES: new Map([
    ['31d531f4-0420-4db5-aecf-bcfe4a0e8c4a', '100000004'],
    ['407e23f9-caf5-4c4a-801d-598cf437d1ae', '100000001'],
    ['94589a22-12e5-4298-aa30-06295acbe1b9', '100000003'],
  ]),
  syncRequestStatusSafely: jest.fn(),
}));
jest.mock('../services/requestWorkflowNotificationService', () => ({ notifyBestEffort: jest.fn() }));

const requestService = require('../services/requestService');
const { syncRequestStatusSafely } = require('../services/salesforceStatusSyncService');
const controller = require('../controllers/approvalHistoryController');

const completedStatusId = '407e23f9-caf5-4c4a-801d-598cf437d1ae';
const cancelledStatusId = '31d531f4-0420-4db5-aecf-bcfe4a0e8c4a';
const rejectedStatusId = '94589a22-12e5-4298-aa30-06295acbe1b9';

function createResponse() {
  const response = {
    locals: { correlationId: 'correlation-1' },
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockImplementation(() => response);
  response.json.mockImplementation(() => response);
  return response;
}

describe('approvalHistoryController.changeRequestStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncRequestStatusSafely.mockResolvedValue(null);
  });

  it('synchronizes an immediate-completion submit after eCredit commits', async () => {
    const request = { id: 'request-1', STATUS_ID: completedStatusId };
    requestService.submitRequest.mockResolvedValue(request);
    syncRequestStatusSafely.mockResolvedValue({ success: true, requestId: 'request-1' });
    const req = {
      params: { id: 'request-1' }, body: {},
      user: { profile: { EFFECTIVE_CODE: '12345', EMAIL: 'user@example.com' } },
    };
    const res = createResponse();
    const next = jest.fn();

    await controller.submitRequest(req, res, next);

    expect(syncRequestStatusSafely).toHaveBeenCalledWith('request-1', completedStatusId, {
      correlationId: 'correlation-1', actorCode: 12345,
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: request, crmSync: { success: true, requestId: 'request-1' } }));
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['reject', rejectedStatusId],
    ['finalConfirm', completedStatusId],
    ['finalCancel', cancelledStatusId],
  ])('synchronizes %s when it changes the request to a CRM status', async (action, statusId) => {
    const request = { id: 'request-1', STATUS_ID: statusId };
    requestService.processApprovalAction.mockResolvedValue(request);
    const req = {
      params: { id: 'request-1' },
      body: { action },
      user: { profile: { ROLE_ID: 'd854d840-d18c-4a7d-87c1-a9186f8664e5', EFFECTIVE_CODE: '12345' } },
    };
    const res = createResponse();
    const next = jest.fn();

    await controller.processApprovalAction(req, res, next);

    expect(syncRequestStatusSafely).toHaveBeenCalledWith('request-1', statusId, {
      correlationId: 'correlation-1', actorCode: 12345,
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: request }));
    expect(next).not.toHaveBeenCalled();
  });

  it('does not synchronize approval saves that leave the status unchanged', async () => {
    requestService.processApprovalAction.mockResolvedValue({ id: 'request-1', STATUS_ID: completedStatusId });
    const req = {
      params: { id: 'request-1' }, body: { action: 'save' },
      user: { profile: { ROLE_ID: 'd854d840-d18c-4a7d-87c1-a9186f8664e5', EFFECTIVE_CODE: '12345' } },
    };
    const res = createResponse();

    await controller.processApprovalAction(req, res, jest.fn());

    expect(syncRequestStatusSafely).not.toHaveBeenCalled();
  });

  it('rejects users who are not System Admins', async () => {
    const req = {
      params: { id: 'request-1' },
      body: { statusId: completedStatusId },
      user: { profile: { ROLE: 'Approver', ROLE_ID: 'approver-role' } },
    };
    const res = createResponse();
    const next = jest.fn();

    await controller.changeRequestStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
    expect(requestService.changeRequestStatus).not.toHaveBeenCalled();
  });

  it.each([completedStatusId, cancelledStatusId, rejectedStatusId])(
    'synchronizes Salesforce when selected for an admin status change to %s', async (statusId) => {
      const request = { id: 'request-1', STATUS_ID: statusId };
      const crmSync = { success: false, message: 'CRM unavailable', requestId: 'request-1' };
      requestService.changeRequestStatus.mockResolvedValue(request);
      syncRequestStatusSafely.mockResolvedValue(crmSync);
      const req = {
        params: { id: 'request-1' },
        body: { statusId, description: 'Administrative status change.', updateSalesforce: true },
        user: { profile: { ROLE_ID: 'd854d840-d18c-4a7d-87c1-a9186f8664e5', EFFECTIVE_CODE: '12345' } },
      };
      const res = createResponse();
      const next = jest.fn();

      await controller.changeRequestStatus(req, res, next);

      expect(syncRequestStatusSafely).toHaveBeenCalledWith('request-1', statusId, {
        correlationId: 'correlation-1', actorCode: 12345,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: { request }, crmSync,
      }));
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('still succeeds in eCredit when Salesforce synchronization fails', async () => {
    const request = { id: 'request-1', STATUS_ID: completedStatusId };
    requestService.changeRequestStatus.mockResolvedValue(request);
    syncRequestStatusSafely.mockResolvedValue({ success: false, message: 'Salesforce unavailable' });
    const req = {
      params: { id: 'request-1' },
      body: { statusId: completedStatusId, description: 'Complete this request.', updateSalesforce: true },
      user: { profile: { ROLE: 'System Admin', EFFECTIVE_CODE: '12345' } },
    };
    const res = createResponse();
    const next = jest.fn();

    await controller.changeRequestStatus(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].crmSync).toMatchObject({ success: false });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not sync CRM when the System Admin leaves the checkbox unchecked', async () => {
    requestService.changeRequestStatus.mockResolvedValue({ id: 'request-1', STATUS_ID: completedStatusId });
    const req = {
      params: { id: 'request-1' },
      body: { statusId: completedStatusId, description: 'Complete this request.' },
      user: { profile: { ROLE: 'System Admin', EFFECTIVE_CODE: '12345' } },
    };
    const res = createResponse();

    await controller.changeRequestStatus(req, res, jest.fn());

    expect(syncRequestStatusSafely).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].crmSync).toBeNull();
  });

  it('rejects the CRM checkbox for statuses outside the three Salesforce mappings', async () => {
    const req = {
      params: { id: 'request-1' },
      body: {
        statusId: 'db8b3768-8466-4974-8dff-4c374b16a639',
        description: 'Return this request to Draft.', updateSalesforce: true,
      },
      user: { profile: { ROLE: 'System Admin', EFFECTIVE_CODE: '12345' } },
    };
    const res = createResponse();
    const next = jest.fn();

    await controller.changeRequestStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }));
    expect(requestService.changeRequestStatus).not.toHaveBeenCalled();
    expect(syncRequestStatusSafely).not.toHaveBeenCalled();
  });

  it('requires a non-blank status change reason before updating', async () => {
    const req = {
      params: { id: 'request-1' },
      body: { statusId: completedStatusId, description: '   ' },
      user: { profile: { ROLE: 'System Admin', EFFECTIVE_CODE: '12345' } },
    };
    const res = createResponse();
    const next = jest.fn();

    await controller.changeRequestStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'A reason is required to change request status.',
    }));
    expect(requestService.changeRequestStatus).not.toHaveBeenCalled();
  });
});
