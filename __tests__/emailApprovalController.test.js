/* eslint-env jest */

jest.mock('../services/emailApprovalActionService', () => ({
  confirmEmailApprovalAction: jest.fn(),
  getEmailApprovalAction: jest.fn(),
}));
jest.mock('../services/requestWorkflowNotificationService', () => ({
  notifyBestEffort: jest.fn(),
}));
jest.mock('../services/salesforceStatusSyncService', () => ({ syncRequestStatusSafely: jest.fn() }));

const emailApprovalActionService = require('../services/emailApprovalActionService');
const { notifyBestEffort } = require('../services/requestWorkflowNotificationService');
const { syncRequestStatusSafely } = require('../services/salesforceStatusSyncService');
const { confirmAction } = require('../controllers/emailApprovalController');

describe('emailApprovalController.confirmAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emailApprovalActionService.confirmEmailApprovalAction.mockResolvedValue({
      requestId: 'request-1',
      action: 'approve',
      isFinalApproval: false,
      approverId: '1001',
      approverEmail: 'approver@example.com',
      approverName: 'APPROVER',
    });
    notifyBestEffort.mockResolvedValue({});
    syncRequestStatusSafely.mockResolvedValue(null);
  });

  it('uses the token-verified approver identity when no authenticated user is present', async () => {
    const req = { params: { token: 'token' }, body: {} };
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await confirmAction(req, res, next);

    expect(notifyBestEffort).toHaveBeenCalledWith(expect.objectContaining({
      event: 'approve',
      requestId: 'request-1',
      actorEmail: 'approver@example.com',
      actorName: 'APPROVER',
      auditActorCode: '1001',
    }));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(notifyBestEffort.mock.calls[0][0]).toMatchObject({ deliveryEmail: undefined, requireDeliveryEmail: true });
  });

  it('reports a skipped notification when no signed-in user can receive DEV/QAS email', async () => {
    notifyBestEffort.mockResolvedValue({ skipped: true, emailSkipped: true, reason: 'NO_SIGNED_IN_USER' });
    const req = { params: { token: 'token' }, body: {} };
    const res = { locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn() };

    await confirmAction(req, res, jest.fn());

    expect(res.json.mock.calls[0][0].data).toMatchObject({
      notificationSkipped: true,
      notificationSkippedReason: 'NO_SIGNED_IN_USER',
    });
  });

  it('always uses the email recipient approver as actor even when another user clicks the link', async () => {
    const req = {
      params: { token: 'token' },
      body: {},
      user: {
        email: 'forwarded@example.com',
        displayName: 'FORWARDED',
        profile: { CODE: '9999', EFFECTIVE_CODE: '9999', LOGGED_IN_EMAIL: 'forwarded@example.com' },
      },
    };
    const res = { locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn() };

    await confirmAction(req, res, jest.fn());

    const options = notifyBestEffort.mock.calls[0][0];
    expect(options.deliveryEmail).toBe('forwarded@example.com');
    expect(options.requireDeliveryEmail).toBe(true);
    const { deliveryEmail, ...actorOptions } = options;
    expect(deliveryEmail).toBe('forwarded@example.com');
    expect(actorOptions).toMatchObject({
      actorEmail: 'approver@example.com',
      actorName: 'APPROVER',
      auditActorCode: '1001',
      user: {
        email: 'approver@example.com',
        displayName: 'APPROVER',
        profile: {
          CODE: '1001',
          EFFECTIVE_CODE: '1001',
          EMAIL: 'approver@example.com',
          LOGGED_IN_EMAIL: 'approver@example.com',
          FULL_NAME: 'APPROVER',
        },
      },
    });
    expect(JSON.stringify(actorOptions)).not.toContain('forwarded@example.com');
    expect(JSON.stringify(actorOptions)).not.toContain('9999');
  });

  it('syncs Salesforce after an email approval rejection', async () => {
    emailApprovalActionService.confirmEmailApprovalAction.mockResolvedValue({
      requestId: 'request-1', action: 'reject', isFinalApproval: false,
      approverId: '1001', approverEmail: 'approver@example.com', approverName: 'APPROVER',
    });
    syncRequestStatusSafely.mockResolvedValue({ success: false, message: 'Salesforce unavailable' });
    const req = { params: { token: 'token' }, body: {} };
    const res = { locals: { correlationId: 'correlation-1' }, status: jest.fn().mockReturnThis(), json: jest.fn() };

    await confirmAction(req, res, jest.fn());

    expect(syncRequestStatusSafely).toHaveBeenCalledWith('request-1', '94589a22-12e5-4298-aa30-06295acbe1b9', {
      correlationId: 'correlation-1', actorCode: '1001',
    });
    expect(res.json.mock.calls[0][0].crmSync).toMatchObject({ success: false });
  });
});
