/* eslint-env jest */

jest.mock('../services/requestService', () => ({ changeRequestStatus: jest.fn() }));
jest.mock('../services/salesforceUpdateSimulationService', () => ({ simulateRequestUpdate: jest.fn() }));
jest.mock('../services/requestWorkflowNotificationService', () => ({ notifyBestEffort: jest.fn() }));

const requestService = require('../services/requestService');
const salesforceSimulation = require('../services/salesforceUpdateSimulationService');
const controller = require('../controllers/approvalHistoryController');

const completedStatusId = '407e23f9-caf5-4c4a-801d-598cf437d1ae';

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

  it('simulates Salesforce only for a completed System Admin status change', async () => {
    const request = { id: 'request-1', STATUS_ID: completedStatusId };
    const crmPayload = { request: { id: 'request-1' }, customerInfo: {} };
    const crmResult = { authentication: { succeeded: true }, update: { accepted: true } };
    requestService.changeRequestStatus.mockResolvedValue(request);
    salesforceSimulation.simulateRequestUpdate.mockResolvedValue(crmResult);
    const req = {
      params: { id: 'request-1' },
      body: {
        statusId: completedStatusId,
        updateApprovers: true,
        approveAllApprovers: true,
        description: 'Approved following an administrative review.',
        updateSalesforce: true,
        crmPayload,
      },
      user: { profile: { ROLE_ID: 'd854d840-d18c-4a7d-87c1-a9186f8664e5', EFFECTIVE_CODE: '12345' } },
    };
    const res = createResponse();
    const next = jest.fn();

    await controller.changeRequestStatus(req, res, next);

    expect(requestService.changeRequestStatus).toHaveBeenCalledWith(
      'request-1',
      completedStatusId,
      12345,
      true,
      true,
    );
    expect(salesforceSimulation.simulateRequestUpdate).toHaveBeenCalledWith(crmPayload);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: { request, crmSimulation: crmResult },
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it('validates CRM payload before changing status', async () => {
    const req = {
      params: { id: 'request-1' },
      body: {
        statusId: completedStatusId,
        description: 'Complete this request.',
        updateSalesforce: true,
        crmPayload: [],
      },
      user: { profile: { ROLE: 'System Admin', EFFECTIVE_CODE: '12345' } },
    };
    const res = createResponse();
    const next = jest.fn();

    await controller.changeRequestStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }));
    expect(requestService.changeRequestStatus).not.toHaveBeenCalled();
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
