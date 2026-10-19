/* eslint-env jest */

const jwt = require('jsonwebtoken');
const { getDatabase } = require('../config/database');
const {
  createEmailApprovalToken,
  getEmailApprovalAction,
  confirmEmailApprovalAction,
} = require('../services/emailApprovalActionService');

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn(),
}));

jest.mock('../config/env', () => ({
  jwt: { secret: 'approval-test-secret' },
}));

jest.mock('../config/database', () => ({
  getDatabase: jest.fn(),
}));

const WAITING_APPROVAL_STATUS_ID = '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b';
const PENDING_APPROVAL_TYPE_ID = 'b4c27a6c-ab7c-4ce5-b885-997f9104c23d';
const payload = {
  type: 'ecredit-email-approval',
  requestId: 'request-1',
  approvalId: 'approval-1',
  approverId: '1001',
  action: 'approve',
};
const approval = {
  ID: 'approval-1',
  REQUEST_ID: 'request-1',
  APPROVER_ID: '1001',
  APPROVAL_STEP: 1,
  APPROVER_EMAIL: 'approver@example.com',
  APPROVER_NAME: 'Approver',
  ALLOW_BACKWARD: true,
};

function createDatabase(query) {
  const transaction = {
    commit: jest.fn(),
    rollback: jest.fn(),
  };
  return {
    query,
    transaction: jest.fn().mockResolvedValue(transaction),
    transactionRef: transaction,
  };
}

describe('emailApprovalActionService request status guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({ ...payload });
  });

  it('creates compact, versioned tokens while preserving the action and expiry settings', () => {
    createEmailApprovalToken({
      requestId: '43440878-4500-411e-8ce9-2118afd7ccd8',
      approvalId: '8893e019-db4a-4a51-9fe0-edd57a64f975',
      approverId: '20100911',
      action: 'approve',
    });

    expect(jwt.sign).toHaveBeenCalledWith({
      v: 2,
      r: 'Q0QIeEUAQR6M6SEYr9fM2A',
      a: 'iJPgGdtKSlGf4O3VemT5dQ',
      p: '20100911',
      x: 'a',
    }, expect.any(String), { expiresIn: '7d', noTimestamp: true });
  });

  it('allows preview only while the request is Waiting-Approval', async () => {
    const database = createDatabase(jest.fn().mockResolvedValue([approval]));
    getDatabase.mockReturnValue(database);

    await expect(getEmailApprovalAction('token')).resolves.toEqual(expect.objectContaining({
      requestId: 'request-1',
      approvalId: 'approval-1',
      action: 'approve',
    }));

    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('TB4.STATUS_ID'),
      expect.objectContaining({
        replacements: expect.objectContaining({ waitingStatusId: WAITING_APPROVAL_STATUS_ID }),
      }),
    );
  });

  it('decodes compact token claims before querying for the pending approval', async () => {
    jwt.verify.mockReturnValue({
      v: 2,
      r: 'Q0QIeEUAQR6M6SEYr9fM2A',
      a: 'iJPgGdtKSlGf4O3VemT5dQ',
      p: '1001',
      x: 'a',
    });
    const database = createDatabase(jest.fn().mockResolvedValue([approval]));
    getDatabase.mockReturnValue(database);

    await expect(getEmailApprovalAction('token')).resolves.toEqual(expect.objectContaining({
      requestId: '43440878-4500-411e-8ce9-2118afd7ccd8',
      approvalId: 'approval-1',
      action: 'approve',
      approverId: '1001',
    }));
    expect(database.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        replacements: expect.objectContaining({
          requestId: '43440878-4500-411e-8ce9-2118afd7ccd8',
          approvalId: '8893e019-db4a-4a51-9fe0-edd57a64f975',
        }),
      }),
    );
  });

  it.each(['approve', 'reject', 'backward'])('expires %s when the request is no longer Waiting-Approval', async (action) => {
    jwt.verify.mockReturnValue({ ...payload, action });
    const database = createDatabase(jest.fn().mockResolvedValue([]));
    getDatabase.mockReturnValue(database);

    await expect(getEmailApprovalAction('token')).rejects.toMatchObject({
      code: 'EMAIL_APPROVAL_EXPIRED',
      statusCode: 410,
    });
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it('does not mutate an approval when the request changes status before confirm', async () => {
    const database = createDatabase(jest.fn()
      .mockResolvedValueOnce([approval])
      .mockResolvedValueOnce([0]));
    getDatabase.mockReturnValue(database);

    await expect(confirmEmailApprovalAction('token', '')).rejects.toMatchObject({
      code: 'EMAIL_APPROVAL_EXPIRED',
      statusCode: 410,
    });

    expect(database.query).toHaveBeenCalledTimes(2);
    expect(database.query.mock.calls[1][0]).toContain('TB4.STATUS_ID');
    expect(database.transactionRef.rollback).toHaveBeenCalledTimes(1);
    expect(database.transactionRef.commit).not.toHaveBeenCalled();
  });

  it('checks the Waiting-Approval status in the approval mutation', async () => {
    const database = createDatabase(jest.fn()
      .mockResolvedValueOnce([approval])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([0])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([{ TOTAL: 1 }]));
    getDatabase.mockReturnValue(database);

    await expect(confirmEmailApprovalAction('token', '')).resolves.toEqual(expect.objectContaining({
      requestId: 'request-1',
      action: 'approve',
      approverId: '1001',
      approverEmail: 'approver@example.com',
      approverName: 'Approver',
    }));

    expect(database.query.mock.calls[1][0]).toContain('TB4.STATUS_ID');
    expect(database.query.mock.calls[1][1].replacements).toEqual(expect.objectContaining({
      pendingTypeId: PENDING_APPROVAL_TYPE_ID,
      waitingStatusId: WAITING_APPROVAL_STATUS_ID,
    }));
    expect(database.query.mock.calls[3][0]).toContain('NOT EXISTS');
    expect(database.query.mock.calls[3][1].replacements).toEqual(expect.objectContaining({
      requestId: payload.requestId,
      approvalId: payload.approvalId,
      approvalStep: 1,
      pendingApprovalTypeId: PENDING_APPROVAL_TYPE_ID,
      approvedApprovalTypeId: 'aab5ce03-1c54-48c8-8305-6b1a017b43fd',
    }));
    expect(database.transactionRef.commit).toHaveBeenCalledTimes(1);
  });
});
