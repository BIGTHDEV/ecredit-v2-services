/* eslint-env jest */

jest.mock('../config/logger', () => ({ error: jest.fn(), warn: jest.fn() }));
jest.mock('../config/env', () => ({ frontendBaseUrl: 'https://frontend.example.com' }));
jest.mock('../services/requestService', () => ({ listApprovalHistory: jest.fn() }));
jest.mock('../services/requestEmailModelService', () => ({ getRequestEmailModel: jest.fn() }));
jest.mock('../emails/requestWorkflowEmail', () => ({ sendRequestWorkflowEmail: jest.fn() }));
jest.mock('../services/emailApprovalActionService', () => ({
  createEmailApprovalToken: jest.fn(({ approvalId, approverId, action }) => `${approvalId}:${approverId}:${action}`),
}));
jest.mock('../services/notificationService', () => ({ createWorkflowNotifications: jest.fn() }));

const { listApprovalHistory } = require('../services/requestService');
const { createWorkflowNotifications } = require('../services/notificationService');
const { getRequestEmailModel } = require('../services/requestEmailModelService');
const { sendRequestWorkflowEmail } = require('../emails/requestWorkflowEmail');
const {
  pendingApprovers,
  isParallelApprovalIncomplete,
  resolveRecipients,
  sendRequestWorkflowNotification,
} = require('../services/requestWorkflowNotificationService');

function approval(overrides = {}) {
  return {
    ID: 'approval-1',
    APPROVAL_TYPE_NAME: 'Pending',
    APPROVAL_STEP: 3,
    SORTING: 3,
    PARALLEL_KEYS: 'FINANCE',
    APPROVER_ID: '1001',
    APPROVER_NAME: 'FIRST-APPROVER',
    APPROVER_EMAIL: 'first@example.com',
    CURRENT_CYCLE: true,
    ...overrides,
  };
}

describe('parallel workflow notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRequestEmailModel.mockImplementation(async () => ({ companyName: 'Acme', salesGroup: '100 - TGEE' }));
    sendRequestWorkflowEmail.mockResolvedValue({ messageId: 'sent' });
  });

  it('selects only the current parallel group and orders it by sorting', () => {
    const first = approval({ ID: 'first', SORTING: 4, APPROVER_ID: '1001' });
    const second = approval({ ID: 'second', SORTING: 3, APPROVER_ID: '1002', APPROVER_NAME: 'SECOND-APPROVER', APPROVER_EMAIL: 'second@example.com' });
    const later = approval({ ID: 'later', APPROVAL_STEP: 4, SORTING: 5, PARALLEL_KEYS: 'LATER' });

    expect(pendingApprovers([first, later, second])).toEqual([second, first]);
  });

  it('sends one email per parallel approver with only that approver action links', async () => {
    const first = approval({ ID: 'first', APPROVER_ID: '1001' });
    const second = approval({ ID: 'second', APPROVER_ID: '1002', APPROVER_NAME: 'SECOND-APPROVER', APPROVER_EMAIL: 'second@example.com' });
    listApprovalHistory.mockResolvedValue([first, second]);

    await sendRequestWorkflowNotification({
      event: 'submit',
      requestId: 'request-1',
      environment: 'prd',
      actorEmail: 'actor@example.com',
      actorName: 'ACTOR',
      user: { profile: { CODE: '1009' } },
      transporter: {},
    });

    expect(sendRequestWorkflowEmail).toHaveBeenCalledTimes(2);
    expect(sendRequestWorkflowEmail.mock.calls.map(([options]) => options.reminderContext))
      .toEqual([{ approvalId: 'first' }, { approvalId: 'second' }]);
    expect(createWorkflowNotifications).toHaveBeenCalledTimes(1);
    expect(createWorkflowNotifications.mock.calls[0][0]).toMatchObject({
      event: 'submit',
      requestId: 'request-1',
      actorEmail: 'actor@example.com',
      actorCode: 1009,
      toRecords: [
        { email: 'first@example.com', name: 'FIRST-APPROVER' },
        { email: 'second@example.com', name: 'SECOND-APPROVER' },
      ],
    });
    const callsByRecipient = new Map(sendRequestWorkflowEmail.mock.calls.map(([options]) => [
      options.recipients.to[0], options.emailModel,
    ]));
    expect(callsByRecipient.get('first@example.com').approvalActions.map((action) => action.url)).toEqual([
      'https://frontend.example.com/email-approval/first%3A1001%3Aapprove',
      'https://frontend.example.com/email-approval/first%3A1001%3Areject',
    ]);
    expect(callsByRecipient.get('second@example.com').approvalActions.map((action) => action.url)).toEqual([
      'https://frontend.example.com/email-approval/second%3A1002%3Aapprove',
      'https://frontend.example.com/email-approval/second%3A1002%3Areject',
    ]);
  });

  it('does not send an approval email while the current parallel step is incomplete', async () => {
    const approved = approval({ ID: 'approved', APPROVER_ID: '1001', APPROVAL_TYPE_NAME: 'Approved' });
    const pending = approval({ ID: 'pending', APPROVER_ID: '1002', APPROVER_NAME: 'SECOND-APPROVER', APPROVER_EMAIL: 'second@example.com' });
    listApprovalHistory.mockResolvedValue([approved, pending]);

    expect(isParallelApprovalIncomplete([approved, pending])).toBe(true);

    const result = await sendRequestWorkflowNotification({
      event: 'approve',
      requestId: 'request-1',
      environment: 'prd',
      actorEmail: 'actor@example.com',
      actorName: 'ACTOR',
      transporter: {},
    });

    expect(result).toEqual({ skipped: true, reason: 'Parallel approval is incomplete' });
    expect(createWorkflowNotifications).not.toHaveBeenCalled();
    expect(getRequestEmailModel).not.toHaveBeenCalled();
    expect(sendRequestWorkflowEmail).not.toHaveBeenCalled();
  });

  it('notifies the next step after every approver in the parallel step has approved', async () => {
    const first = approval({ ID: 'first', APPROVER_ID: '1001', APPROVAL_TYPE_NAME: 'Approved' });
    const second = approval({ ID: 'second', APPROVER_ID: '1002', APPROVAL_TYPE_NAME: 'Approved', APPROVER_NAME: 'SECOND-APPROVER', APPROVER_EMAIL: 'second@example.com' });
    const next = approval({ ID: 'next', APPROVAL_STEP: 4, SORTING: 5, PARALLEL_KEYS: '', APPROVER_ID: '1003', APPROVER_NAME: 'NEXT-APPROVER', APPROVER_EMAIL: 'next@example.com' });
    listApprovalHistory.mockResolvedValue([first, second, next]);

    expect(isParallelApprovalIncomplete([first, second, next])).toBe(false);

    await sendRequestWorkflowNotification({
      event: 'approve',
      requestId: 'request-1',
      environment: 'prd',
      actorEmail: 'actor@example.com',
      actorName: 'ACTOR',
      transporter: {},
    });

    expect(sendRequestWorkflowEmail).toHaveBeenCalledTimes(1);
    expect(sendRequestWorkflowEmail.mock.calls[0][0].recipients.to).toEqual(['next@example.com']);
  });

  it('still sends workflow email when in-app notification creation fails', async () => {
    listApprovalHistory.mockResolvedValue([approval()]);
    createWorkflowNotifications.mockRejectedValueOnce(new Error('table missing'));

    await sendRequestWorkflowNotification({
      event: 'submit',
      requestId: 'request-1',
      environment: 'prd',
      actorEmail: 'actor@example.com',
      actorName: 'ACTOR',
      transporter: {},
    });

    expect(sendRequestWorkflowEmail).toHaveBeenCalledTimes(1);
  });

  it('delivers DEV email-link approval emails to the signed-in user while keeping the approver actor', async () => {
    listApprovalHistory.mockResolvedValue([approval({ APPROVER_EMAIL: 'next@example.com' })]);

    await sendRequestWorkflowNotification({
      event: 'approve',
      requestId: 'request-1',
      environment: 'dev',
      actorEmail: 'approver@example.com',
      actorName: 'APPROVER',
      auditActorCode: '2001',
      deliveryEmail: 'tester@example.com',
      requireDeliveryEmail: true,
      transporter: {},
    });

    expect(createWorkflowNotifications.mock.calls[0][0]).toMatchObject({ actorEmail: 'approver@example.com', actorCode: 2001 });
    expect(sendRequestWorkflowEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipients: { to: ['next@example.com'], cc: [] },
      actorEmail: 'approver@example.com',
      deliveryEmail: 'tester@example.com',
      auditActorCode: '2001',
    }));
  });

  it('skips DEV email-link approval emails when no user is signed in but still creates in-app notifications', async () => {
    listApprovalHistory.mockResolvedValue([approval()]);

    const result = await sendRequestWorkflowNotification({
      event: 'approve',
      requestId: 'request-1',
      environment: 'dev',
      actorEmail: 'approver@example.com',
      actorName: 'APPROVER',
      auditActorCode: '2001',
      requireDeliveryEmail: true,
      transporter: {},
    });

    expect(result).toEqual({ skipped: true, emailSkipped: true, reason: 'NO_SIGNED_IN_USER' });
    expect(createWorkflowNotifications).toHaveBeenCalledTimes(1);
    expect(sendRequestWorkflowEmail).not.toHaveBeenCalled();
  });

  it('still sends PRD email-link approval emails to the real approver without a signed-in user', async () => {
    listApprovalHistory.mockResolvedValue([approval({ APPROVER_EMAIL: 'next@example.com' })]);

    await sendRequestWorkflowNotification({
      event: 'approve',
      requestId: 'request-1',
      environment: 'prd',
      actorEmail: 'approver@example.com',
      actorName: 'APPROVER',
      requireDeliveryEmail: true,
      transporter: {},
    });

    expect(sendRequestWorkflowEmail).toHaveBeenCalledTimes(1);
    expect(sendRequestWorkflowEmail.mock.calls[0][0].recipients.to).toEqual(['next@example.com']);
  });

  it('sends backward notifications to BDS Review and copies the current-cycle backward approver', () => {
    const history = [
      approval({
        APPROVER_TYPE_NAME: 'Requester',
        APPROVAL_STEP: 1,
        APPROVER_NAME: 'REQUESTER',
        APPROVER_EMAIL: 'requester@example.com',
      }),
      approval({
        APPROVER_TYPE_NAME: 'Manager Approve',
        APPROVAL_STEP: 2,
        APPROVAL_TYPE_NAME: 'Approved',
        APPROVER_NAME: 'APPROVER',
        APPROVER_EMAIL: 'approver@example.com',
      }),
      approval({
        APPROVER_TYPE_NAME: 'Manager Approve',
        APPROVAL_STEP: 3,
        APPROVAL_TYPE_NAME: 'Backward',
        APPROVER_NAME: 'BACKWARD-APPROVER',
        APPROVER_EMAIL: 'backward@example.com',
      }),
      approval({
        APPROVER_TYPE_NAME: 'Manager Approve',
        APPROVAL_STEP: 3,
        APPROVAL_TYPE_NAME: 'Backward',
        APPROVER_NAME: 'OLD-BACKWARD-APPROVER',
        APPROVER_EMAIL: 'old-backward@example.com',
        CURRENT_CYCLE: false,
      }),
      approval({
        APPROVER_TYPE_NAME: 'Manager Approve (BDS Review)',
        APPROVAL_STEP: 2,
        APPROVAL_TYPE_NAME: 'Pending',
        APPROVER_NAME: 'BDS-APPROVER',
        APPROVER_EMAIL: 'bds@example.com',
      }),
    ];

    expect(resolveRecipients('backward', history, {
      email: 'actor@example.com',
      displayName: 'ACTOR',
    })).toEqual({
      toRecords: [{ email: 'bds@example.com', name: 'BDS-APPROVER' }],
      ccRecords: [{ email: 'backward@example.com', name: 'BACKWARD-APPROVER' }],
      dear: 'BDS-APPROVER',
    });
  });

  it('includes company and sales group in the backward subject', async () => {
    listApprovalHistory.mockResolvedValue([
      approval({
        APPROVER_TYPE_NAME: 'Requester',
        APPROVAL_STEP: 1,
        APPROVER_NAME: 'REQUESTER',
        APPROVER_EMAIL: 'requester@example.com',
      }),
      approval({
        APPROVER_TYPE_NAME: 'Manager Approve (BDS Review)',
        APPROVAL_STEP: 2,
        APPROVER_NAME: 'BDS-APPROVER',
        APPROVER_EMAIL: 'bds@example.com',
      }),
      approval({
        APPROVER_TYPE_NAME: 'Manager Approve',
        APPROVAL_STEP: 3,
        APPROVAL_TYPE_NAME: 'Backward',
        APPROVER_NAME: 'BACKWARD-APPROVER',
        APPROVER_EMAIL: 'backward@example.com',
      }),
    ]);

    await sendRequestWorkflowNotification({
      event: 'backward',
      requestId: 'request-1',
      environment: 'prd',
      actorEmail: 'backward@example.com',
      actorName: 'BACKWARD-APPROVER',
      transporter: {},
    });

    expect(sendRequestWorkflowEmail.mock.calls[0][0].subject)
      .toBe('Request was sent backward Acme (100 - TGEE)');
    expect(sendRequestWorkflowEmail.mock.calls[0][0].recipients).toEqual({
      to: ['bds@example.com'],
      cc: ['backward@example.com'],
    });
    expect(createWorkflowNotifications.mock.calls[0][0]).toMatchObject({
      toRecords: [{ email: 'bds@example.com', name: 'BDS-APPROVER' }],
      ccRecords: [{ email: 'backward@example.com', name: 'BACKWARD-APPROVER' }],
    });
    expect(listApprovalHistory).toHaveBeenCalledWith('request-1', { includeDisabledApprovals: true });
  });
});
