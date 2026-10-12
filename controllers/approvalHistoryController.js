const requestService = require('../services/requestService');
const { notifyBestEffort } = require('../services/requestWorkflowNotificationService');
const { isSystemAdminRole } = require('../helpers/roleAuthorization');
const { effectiveEmployeeCode, approvalAuditEmployeeCode } = require('../helpers/userIdentity');

const FINAL_STATUS_ID = '014e8e8b-42cf-4b2f-8cae-e395e26efbcd';
const COMPLETED_STATUS_ID = '407e23f9-caf5-4c4a-801d-598cf437d1ae';

async function listApprovalHistory(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const data = await requestService.listApprovalHistory(req.params.requestId);
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
    await notifyBestEffort({
      event: String(request?.STATUS_ID || '') === COMPLETED_STATUS_ID ? 'completed' : 'submit',
      requestId: req.params.id,
      environment: process.env.NODE_ENV,
      actorEmail: req.user?.profile?.EMAIL || req.user?.email,
      actorName: req.user?.profile?.FULL_NAME || req.user?.displayName,
      user: req.user,
    });
    res.status(200).json({ success: true, data: request, correlationId });
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
    res.status(200).json({ success: true, data: request, correlationId });
  } catch (error) {
    next(error);
  }
}

module.exports = { listApprovalHistory, getApprovalSubmitOptions, submitRequest, processApprovalAction };
