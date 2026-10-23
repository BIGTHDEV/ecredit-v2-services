const requestService = require('../services/requestService');
const { CRM_STATUS_CODES, syncRequestStatusSafely } = require('../services/salesforceStatusSyncService');
const { notifyBestEffort } = require('../services/requestWorkflowNotificationService');
const { isSystemAdminRole } = require('../helpers/roleAuthorization');
const { effectiveEmployeeCode, approvalAuditEmployeeCode } = require('../helpers/userIdentity');

const FINAL_STATUS_ID = '014e8e8b-42cf-4b2f-8cae-e395e26efbcd';
const COMPLETED_STATUS_ID = '407e23f9-caf5-4c4a-801d-598cf437d1ae';

async function listApprovalHistory(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const includeDisabledApprovals = req.query.includeDisabledApprovals === 'true'
      && isSystemAdminRole(req.user?.profile?.ROLE, req.user?.profile?.ROLE_ID);
    const data = await requestService.listApprovalHistory(req.params.requestId, { includeDisabledApprovals });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });
  } catch (error) {
    next(error);
  }
}

async function getApprovalSubmitOptions(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const data = await requestService.getApprovalSubmitOptions(req.params.requestId);
    if (!data) {
      const error = new Error(`Request ${req.params.requestId} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });
  } catch (error) {
    next(error);
  }
}

async function submitRequest(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(updatedBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    const request = await requestService.submitRequest(req.params.id, req.body, updatedBy);
    const crmSync = await syncRequestStatusSafely(req.params.id, request?.STATUS_ID, {
      correlationId, actorCode: updatedBy,
    });
    await notifyBestEffort({
      event: String(request?.STATUS_ID || '') === COMPLETED_STATUS_ID ? 'completed' : 'submit',
      requestId: req.params.id,
      environment: process.env.NODE_ENV,
      actorEmail: req.user?.profile?.EMAIL || req.user?.email,
      actorName: req.user?.profile?.FULL_NAME || req.user?.displayName,
      user: req.user,
    });
    res.status(200).json({ success: true, data: request, crmSync, correlationId });
  } catch (error) {
    next(error);
  }
}

async function processApprovalAction(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    const auditActorCode = approvalAuditEmployeeCode(req.user?.profile);
    const isSystemAdmin = isSystemAdminRole(req.user?.profile?.ROLE, req.user?.profile?.ROLE_ID);
    if (!Number.isInteger(updatedBy) || !Number.isInteger(auditActorCode)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const request = await requestService.processApprovalAction(
      req.params.id,
      req.body?.action,
      req.body ?? {},
      updatedBy,
      isSystemAdmin,
      auditActorCode,
    );
    const crmSync = ['reject', 'finalConfirm', 'finalCancel'].includes(req.body?.action)
      ? await syncRequestStatusSafely(req.params.id, request?.STATUS_ID, {
        correlationId, actorCode: auditActorCode,
      })
      : null;
    const reachedFinalStatus = String(request?.STATUS_ID || '') === FINAL_STATUS_ID;
    if (['approve', 'reject', 'backward'].includes(req.body?.action)) {
      await notifyBestEffort({
        event: req.body.action === 'approve' && (request.isFinalApproval || reachedFinalStatus)
          ? 'final'
          : req.body.action,
        requestId: req.params.id,
        environment: process.env.NODE_ENV,
        actorEmail: req.user?.profile?.EMAIL || req.user?.email,
        actorName: req.user?.profile?.FULL_NAME || req.user?.displayName,
        user: req.user,
        auditActorCode,
      });
    } else if (req.body?.action === 'finalConfirm' || req.body?.action === 'finalCancel') {
      await notifyBestEffort({
        event: req.body.action === 'finalConfirm' ? 'completed' : 'final-cancel',
        requestId: req.params.id,
        environment: process.env.NODE_ENV,
        actorEmail: req.user?.profile?.EMAIL || req.user?.email,
        actorName: req.user?.profile?.FULL_NAME || req.user?.displayName,
        user: req.user,
        auditActorCode,
      });
    }
    res.status(200).json({ success: true, data: request, crmSync, correlationId });
  } catch (error) {
    next(error);
  }
}

async function changeRequestStatus(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const isSystemAdmin = isSystemAdminRole(req.user?.profile?.ROLE, req.user?.profile?.ROLE_ID);
    if (!isSystemAdmin) {
      const error = new Error('Only System Admin can change request status.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(updatedBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const {
      statusId,
      updateApprovers = false,
      approveAllApprovers = false,
      updateSalesforce = false,
      description,
    } = req.body ?? {};
    if (typeof description !== 'string' || !description.trim()) {
      const error = new Error('A reason is required to change request status.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (description.trim().length > 2000) {
      const error = new Error('The status change reason must not exceed 2000 characters.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    req.body.description = description.trim();

    if (typeof updateApprovers !== 'boolean') {
      const error = new Error('updateApprovers must be a boolean.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (typeof approveAllApprovers !== 'boolean') {
      const error = new Error('approveAllApprovers must be a boolean.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (typeof updateSalesforce !== 'boolean') {
      const error = new Error('updateSalesforce must be a boolean.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (updateSalesforce && !CRM_STATUS_CODES.has(String(statusId || '').toLowerCase())) {
      const error = new Error('Salesforce updates are only available for Cancelled, Completed, or Rejected statuses.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    const request = await requestService.changeRequestStatus(
      req.params.id,
      statusId,
      updatedBy,
      updateApprovers,
      approveAllApprovers,
    );
    if (!request) {
      const error = new Error(`Request ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    const crmSync = updateSalesforce
      ? await syncRequestStatusSafely(req.params.id, request?.STATUS_ID, { correlationId, actorCode: updatedBy })
      : null;

    res.status(200).json({
      success: true,
      data: { request },
      crmSync,
      correlationId,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listApprovalHistory,
  getApprovalSubmitOptions,
  submitRequest,
  processApprovalAction,
  changeRequestStatus,
};
