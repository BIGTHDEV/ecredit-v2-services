const { QueryTypes } = require('sequelize');
const { getDatabase } = require('../config/database');

async function propagateApprovedValues({
  requestId,
  approvalId,
  approvalStep,
  updatedBy,
  pendingApprovalTypeId,
  approvedApprovalTypeId,
  transaction,
}) {
  await getDatabase().query(
    `UPDATE TB1
     SET LIMIT_AMOUNT = TB2.LIMIT_AMOUNT,
         TERM_ID = TB2.TERM_ID,
         RATING_ID = TB2.RATING_ID,
         IS_PERMANENT = TB2.IS_PERMANENT,
         IS_TEMPORARY = TB2.IS_TEMPORARY,
         VALID_FROM = TB2.VALID_FROM,
         VALID_TO = TB2.VALID_TO,
         IS_CLEAR_OUTSTANDING_BALANCE = TB2.IS_CLEAR_OUTSTANDING_BALANCE,
         IS_WITHIN_APPROVED_LIMIT = TB2.IS_WITHIN_APPROVED_LIMIT,
         IS_BANK_GUARANTEE = TB2.IS_BANK_GUARANTEE,
         BANK_GUARANTEE_AMOUNT = TB2.BANK_GUARANTEE_AMOUNT,
         IS_CASH_DEPOSIT = TB2.IS_CASH_DEPOSIT,
         CASH_DEPOSIT_AMOUNT = TB2.CASH_DEPOSIT_AMOUNT,
         UPDATED_BY = :auditBy,
         UPDATED_DATE = GETDATE()
     FROM APPROVALS AS TB1
     INNER JOIN APPROVALS AS TB2
       ON CONVERT(VARCHAR(36), TB2.REQUEST_ID) COLLATE DATABASE_DEFAULT
         = CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT
       AND CONVERT(VARCHAR(36), TB2.ID) COLLATE DATABASE_DEFAULT
         = CONVERT(VARCHAR(36), :approvalId) COLLATE DATABASE_DEFAULT
       AND CONVERT(VARCHAR(36), TB2.APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
         = CONVERT(VARCHAR(36), :approvedApprovalTypeId) COLLATE DATABASE_DEFAULT
       AND TB2.ENABLED = '1'
     WHERE CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT
         = CONVERT(VARCHAR(36), :requestId) COLLATE DATABASE_DEFAULT
       AND CONVERT(VARCHAR(36), TB1.APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
         = CONVERT(VARCHAR(36), :pendingApprovalTypeId) COLLATE DATABASE_DEFAULT
       AND TB1.APPROVAL_STEP > :approvalStep
       AND TB1.ENABLED = '1'
       AND NOT EXISTS (
         SELECT 1
         FROM APPROVALS AS TB3
         WHERE CONVERT(VARCHAR(36), TB3.REQUEST_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :requestId) COLLATE DATABASE_DEFAULT
           AND TB3.APPROVAL_STEP = :approvalStep
           AND CONVERT(VARCHAR(36), TB3.APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :pendingApprovalTypeId) COLLATE DATABASE_DEFAULT
           AND TB3.ENABLED = '1'
       )`,
    {
      replacements: {
        requestId,
        approvalId,
        approvalStep,
        auditBy: updatedBy,
        pendingApprovalTypeId,
        approvedApprovalTypeId,
      },
      type: QueryTypes.UPDATE,
      transaction,
    },
  );
}

module.exports = { propagateApprovedValues };
