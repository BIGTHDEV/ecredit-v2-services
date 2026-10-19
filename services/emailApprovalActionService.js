const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { getDatabase } = require('../config/database');
const { QueryTypes } = require('sequelize');
const { propagateApprovedValues } = require('./approvalWorkflowService');

const PENDING_APPROVAL_TYPE_ID = 'b4c27a6c-ab7c-4ce5-b885-997f9104c23d';
const WAITING_APPROVAL_STATUS_ID = '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b';
const ACTION_TYPE_IDS = {
  approve: 'aab5ce03-1c54-48c8-8305-6b1a017b43fd',
  reject: 'b08a2acd-e173-4de0-a528-1533b89c1c21',
  backward: 'b76065cc-6507-458d-94ce-87231cbaa57c',
};
const ACTIONS = new Set(Object.keys(ACTION_TYPE_IDS));
const COMPACT_ACTION_CODES = { approve: 'a', reject: 'r', backward: 'b' };
const ACTIONS_BY_COMPACT_CODE = { a: 'approve', r: 'reject', b: 'backward' };

function actionError(message, code = 'EMAIL_APPROVAL_EXPIRED', statusCode = 410) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function encodeGuid(value) {
  const hex = String(value).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Email approval IDs must be GUIDs.');
  return Buffer.from(hex, 'hex').toString('base64url');
}

function decodeGuid(value) {
  if (typeof value !== 'string') throw new Error('Invalid email approval ID.');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 16 || bytes.toString('base64url') !== value) {
    throw new Error('Invalid email approval ID.');
  }
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createEmailApprovalToken({ requestId, approvalId, approverId, action, expiresIn = '7d' }) {
  if (!ACTIONS.has(action)) throw new Error('Unsupported email approval action.');
  return jwt.sign({
    v: 2,
    r: encodeGuid(requestId),
    a: encodeGuid(approvalId),
    p: String(approverId),
    x: COMPACT_ACTION_CODES[action],
  }, config.jwt.secret, { expiresIn, noTimestamp: true });
}

function verifyEmailApprovalToken(token, { ignoreExpiration = false } = {}) {
  try {
    const payload = jwt.verify(token, config.jwt.secret, { ignoreExpiration });
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid token payload.');
    }
    if (payload.type === 'ecredit-email-approval' && ACTIONS.has(payload.action)) {
      return payload;
    }
    const action = ACTIONS_BY_COMPACT_CODE[payload.x];
    if (payload.v !== 2 || !action || typeof payload.p !== 'string' || !payload.p) {
      throw new Error('Invalid token type.');
    }
    return {
      ...payload,
      type: 'ecredit-email-approval',
      requestId: decodeGuid(payload.r),
      approvalId: decodeGuid(payload.a),
      approverId: payload.p,
      action,
    };
  } catch (error) {
    throw actionError('This approval action has expired or is invalid.');
  }
}

async function findPendingApproval(payload, transaction) {
  const rows = await getDatabase().query(
    `SELECT TOP 1
       TB1.ID, TB1.REQUEST_ID, TB1.APPROVER_ID, TB1.DESCRIPTION,
       TB1.APPROVAL_TYPE_ID, TB1.APPROVAL_STEP, TB1.SORTING,
       TB3.CURRENT_EMAIL AS APPROVER_EMAIL,
       CONCAT(TB3.INITIALS, '-', TB3.USERNAME) AS APPROVER_NAME,
       CAST(ISNULL(TB2.ALLOW_BACKWARD, 0) AS BIT) AS ALLOW_BACKWARD
     FROM APPROVALS AS TB1
     LEFT JOIN APPROVER_TYPES AS TB2 ON TB2.ID = TB1.APPROVER_TYPE_ID
     LEFT JOIN S_EMPLOYEE1 AS TB3 ON TRY_CONVERT(BIGINT, TB3.EMP_CODE) = TRY_CONVERT(BIGINT, TB1.APPROVER_ID)
     INNER JOIN REQUESTS AS TB4
       ON CONVERT(VARCHAR(36), TB4.ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT
       AND TB4.ENABLED = '1'
       AND CONVERT(VARCHAR(36), TB4.STATUS_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :waitingStatusId) COLLATE DATABASE_DEFAULT
     WHERE CONVERT(VARCHAR(36), TB1.ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :approvalId) COLLATE DATABASE_DEFAULT
       AND CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :requestId) COLLATE DATABASE_DEFAULT
       AND TRY_CONVERT(BIGINT, TB1.APPROVER_ID) = TRY_CONVERT(BIGINT, :approverId)
       AND TB1.ENABLED = '1'
       AND CONVERT(VARCHAR(36), TB1.APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :pendingTypeId) COLLATE DATABASE_DEFAULT`,
    {
      replacements: {
        approvalId: payload.approvalId,
        requestId: payload.requestId,
        approverId: payload.approverId,
        pendingTypeId: PENDING_APPROVAL_TYPE_ID,
        waitingStatusId: WAITING_APPROVAL_STATUS_ID,
      },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  const approval = rows[0];
  if (!approval) throw actionError('This approval action is no longer available.');
  if (payload.action === 'backward' && !['1', 1, true].includes(approval.ALLOW_BACKWARD)) {
    throw actionError('Backward is not available for this approval step.');
  }
  return approval;
}

function normalizeComment(comment, action) {
  const value = typeof comment === 'string' ? comment.trim() : '';
  if ((action === 'reject' || action === 'backward') && !value) {
    const error = new Error('Comment is required for this action.');
    error.code = 'COMMENT_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  return value;
}

async function getEmailApprovalAction(token) {
  const payload = verifyEmailApprovalToken(token);
  const approval = await findPendingApproval(payload);
  return {
    requestId: String(payload.requestId),
    approvalId: String(approval.ID),
    action: payload.action,
    approverId: String(approval.APPROVER_ID),
    approverEmail: approval.APPROVER_EMAIL || '',
    approverName: approval.APPROVER_NAME || '',
    allowBackward: Boolean(approval.ALLOW_BACKWARD),
    commentRequired: payload.action === 'reject' || payload.action === 'backward',
  };
}

async function confirmEmailApprovalAction(token, comment) {
  const payload = verifyEmailApprovalToken(token);
  const normalizedComment = normalizeComment(comment, payload.action);
  const database = getDatabase();
  const transaction = await database.transaction();
  let isFinalApproval = false;
  try {
    const approval = await findPendingApproval(payload, transaction);
    const [affectedRows] = await database.query(
      `UPDATE APPROVALS
       SET APPROVAL_TYPE_ID = :actionTypeId,
           DESCRIPTION = CASE WHEN :comment = '' THEN DESCRIPTION ELSE :comment END,
           UPDATED_BY = :updatedBy,
           UPDATED_DATE = GETDATE()
       WHERE CONVERT(VARCHAR(36), ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :approvalId) COLLATE DATABASE_DEFAULT
         AND CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :requestId) COLLATE DATABASE_DEFAULT
         AND TRY_CONVERT(BIGINT, APPROVER_ID) = TRY_CONVERT(BIGINT, :approverId)
         AND ENABLED = '1'
         AND CONVERT(VARCHAR(36), APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :pendingTypeId) COLLATE DATABASE_DEFAULT
         AND EXISTS (
           SELECT 1 FROM REQUESTS AS TB4
           WHERE CONVERT(VARCHAR(36), TB4.ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), APPROVALS.REQUEST_ID) COLLATE DATABASE_DEFAULT
             AND TB4.ENABLED = '1'
             AND CONVERT(VARCHAR(36), TB4.STATUS_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :waitingStatusId) COLLATE DATABASE_DEFAULT
         )`,
      {
        replacements: {
          actionTypeId: ACTION_TYPE_IDS[payload.action],
          comment: normalizedComment,
          updatedBy: payload.approverId,
          approvalId: payload.approvalId,
          requestId: payload.requestId,
          approverId: payload.approverId,
          pendingTypeId: PENDING_APPROVAL_TYPE_ID,
          waitingStatusId: WAITING_APPROVAL_STATUS_ID,
        },
        type: QueryTypes.UPDATE,
        transaction,
      },
    );
    if (!affectedRows) throw actionError('This approval action is no longer available.');

    if (payload.action === 'approve') {
      await database.query(
        `UPDATE APPROVALS
         SET APPROVAL_TYPE_ID = :actionTypeId,
             DESCRIPTION = CASE WHEN :comment = '' THEN DESCRIPTION ELSE :comment END,
             UPDATED_BY = :updatedBy,
             UPDATED_DATE = GETDATE()
         WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :requestId) COLLATE DATABASE_DEFAULT
           AND TRY_CONVERT(BIGINT, APPROVER_ID) = TRY_CONVERT(BIGINT, :approverId)
           AND ENABLED = '1'
           AND CONVERT(VARCHAR(36), APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :pendingTypeId) COLLATE DATABASE_DEFAULT
           AND CONVERT(VARCHAR(36), ID) COLLATE DATABASE_DEFAULT <> CONVERT(VARCHAR(36), :approvalId) COLLATE DATABASE_DEFAULT`,
        {
          replacements: {
            actionTypeId: ACTION_TYPE_IDS.approve,
            comment: normalizedComment,
            updatedBy: payload.approverId,
            requestId: payload.requestId,
            approverId: payload.approverId,
            pendingTypeId: PENDING_APPROVAL_TYPE_ID,
            approvalId: payload.approvalId,
          },
          type: QueryTypes.UPDATE,
          transaction,
        },
      );
      await propagateApprovedValues({
        requestId: payload.requestId,
        approvalId: payload.approvalId,
        approvalStep: approval.APPROVAL_STEP,
        updatedBy: payload.approverId,
        pendingApprovalTypeId: PENDING_APPROVAL_TYPE_ID,
        approvedApprovalTypeId: ACTION_TYPE_IDS.approve,
        transaction,
      });
    }

    if (payload.action === 'backward') {
      await database.query(
        `UPDATE APPROVALS SET ENABLED = '0', UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
         WHERE REQUEST_ID = :requestId AND ENABLED = '1'`,
        { replacements: { requestId: payload.requestId, updatedBy: payload.approverId }, type: QueryTypes.UPDATE, transaction },
      );
      await database.query(
        `UPDATE REQUESTS SET STATUS_ID = :draftStatusId, UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
         WHERE ID = :requestId AND ENABLED = '1'`,
        { replacements: { requestId: payload.requestId, updatedBy: payload.approverId, draftStatusId: 'db8b3768-8466-4974-8dff-4c374b16a639' }, type: QueryTypes.UPDATE, transaction },
      );
    } else if (payload.action === 'reject') {
      await database.query(
        `UPDATE REQUESTS SET STATUS_ID = :rejectedStatusId, CANCELLED_NOTES = :comment, UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
         WHERE ID = :requestId AND ENABLED = '1'`,
        {
          replacements: {
            requestId: payload.requestId,
            comment: normalizedComment,
            updatedBy: payload.approverId,
            rejectedStatusId: '94589a22-12e5-4298-aa30-06295acbe1b9',
          },
          type: QueryTypes.UPDATE,
          transaction,
        },
      );
    } else {
      const pendingRows = await database.query(
        `SELECT COUNT(1) AS TOTAL FROM APPROVALS
         WHERE REQUEST_ID = :requestId AND ENABLED = '1'
           AND CONVERT(VARCHAR(36), APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :pendingTypeId) COLLATE DATABASE_DEFAULT`,
        { replacements: { requestId: payload.requestId, pendingTypeId: PENDING_APPROVAL_TYPE_ID }, type: QueryTypes.SELECT, transaction },
      );
      if (Number(pendingRows[0]?.TOTAL) === 0) {
        isFinalApproval = true;
        await database.query(
          `UPDATE REQUESTS SET STATUS_ID = :finalStatusId, UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
           WHERE ID = :requestId AND ENABLED = '1'`,
          { replacements: { requestId: payload.requestId, updatedBy: payload.approverId, finalStatusId: '014e8e8b-42cf-4b2f-8cae-e395e26efbcd' }, type: QueryTypes.UPDATE, transaction },
        );
      }
    }
    await transaction.commit();
    return {
      requestId: String(payload.requestId),
      action: payload.action,
      isFinalApproval,
      approverId: String(approval.APPROVER_ID),
      approverEmail: approval.APPROVER_EMAIL || '',
      approverName: approval.APPROVER_NAME || '',
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = {
  ACTION_TYPE_IDS,
  createEmailApprovalToken,
  verifyEmailApprovalToken,
  getEmailApprovalAction,
  confirmEmailApprovalAction,
};
