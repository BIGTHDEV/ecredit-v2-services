const logger = require('../config/logger');
const requestService = require('../services/requestService');
const companyInfoSuggestionService = require('../services/powerPlatformCompanyInfoService');
const { getRequestEmailModel } = require('../services/requestEmailModelService');
const { sendRequestCompletedEmail } = require('../emails/requestCompletedEmail');
const { notifyBestEffort } = require('../services/requestWorkflowNotificationService');
const { isSystemAdminRole } = require('../helpers/roleAuthorization');
const { effectiveEmployeeCode, approvalAuditEmployeeCode } = require('../helpers/userIdentity');

function companyInfoUserName(profile) {
  const initials = String(profile?.LOGGED_IN_INITIALS || profile?.INITIALS || '').trim();
  const fullName = String(profile?.LOGGED_IN_FULL_NAME || profile?.FULL_NAME || '')
    .trim()
    .replace(/^(?:mr|mrs|ms|miss|dr|prof)\.?\s+/i, '');
  if (initials && fullName) return `${initials} (${fullName})`;

  return String(profile?.LOGGED_IN_USERNAME
    || (!profile?.IS_VIEWING_AS ? profile?.USERNAME : '')
    || '').trim();
}

async function listRequests(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const data = await requestService.listRequests(req.query);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });

    logger.debug('Requests returned', {
      correlationId,
      route: { method: req.method, path: req.path },
      payload: { page: data.pagination.page, pageSize: data.pagination.pageSize, totalItems: data.pagination.totalItems },
    });
  } catch (error) {
    logger.error(`Error in listRequests: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function getRequest(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const request = await requestService.getRequestById(req.params.id);

    if (!request) {
      const error = new Error(`Request ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data: request, correlationId });

    logger.debug('Request returned', {
      correlationId,
      route: { method: req.method, path: req.path },
      payload: { id: request.id },
    });
  } catch (error) {
    logger.error(`Error in getRequest: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function suggestRequestCustomerInfo(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const taxId = req.body?.taxId;
    if (typeof taxId !== 'string' || !/^\d{13}$/.test(taxId)) {
      const error = new Error('Tax ID must contain exactly 13 digits.');
      error.statusCode = 400;
      error.code = 'INVALID_TAX_ID';
      throw error;
    }

    const employeeCode = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(employeeCode)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const request = await requestService.getRequestById(req.params.id);
    if (!request) {
      const error = new Error(`Request ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    const profile = req.user?.profile;
    const isSystemAdmin = isSystemAdminRole(profile?.ROLE, profile?.ROLE_ID);
    const isRequestParticipant = request.REQUESTED_BY === employeeCode
      || request.SUBMITTED_BY === employeeCode;
    if (String(request.STATUS).toLowerCase() !== 'draft' || (!isSystemAdmin && !isRequestParticipant)) {
      const error = new Error('Only request participants may search company information for a draft request.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const userEmail = String(profile?.LOGGED_IN_EMAIL || req.user?.email || profile?.EMAIL || '').trim();
    const userName = companyInfoUserName(profile);
    const data = await companyInfoSuggestionService.suggestCompanyInfo(taxId, {
      userEmail,
      userName,
      onRequestPayload: (payload) => {
        res.locals.outboundRequests = [{
          system: 'Power Platform',
          method: 'POST',
          body: payload,
        }];
      },
    });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });

    logger.info('Company information suggestions generated', {
      correlationId,
      route: { method: req.method, path: req.path },
      payload: { requestId: req.params.id, sourceCount: data.sources.length },
    });
  } catch (error) {
    logger.error(`Error in suggestRequestCustomerInfo: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      errorCode: error.code,
      stack: error.stack,
    });
    next(error);
  }
}

async function updateRequestCustomerInfo(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(updatedBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const request = await requestService.updateRequestCustomerInfo(req.params.id, req.body, updatedBy);
    if (!request) {
      const error = new Error(`Request ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    res.status(200).json({ success: true, data: request, correlationId });
  } catch (error) {
    logger.error(`Error in updateRequestCustomerInfo: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function updateRequestCreditSuggestion(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(updatedBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const request = await requestService.updateRequestCreditSuggestion(req.params.id, req.body, updatedBy);
    if (!request) {
      const error = new Error(`Request ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    res.status(200).json({ success: true, data: request, correlationId });
  } catch (error) {
    logger.error(`Error in updateRequestCreditSuggestion: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function updateRequestScoringAndPayment(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(updatedBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const request = await requestService.updateRequestScoringAndPayment(req.params.id, req.body, updatedBy);
    if (!request) {
      const error = new Error(`Request ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    res.status(200).json({ success: true, data: request, correlationId });
  } catch (error) {
    logger.error(`Error in updateRequestScoringAndPayment: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function updateRequestRequestedDetails(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(updatedBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    const request = await requestService.updateRequestRequestedDetails(req.params.id, req.body, updatedBy);
    if (!request) {
      const error = new Error(`Request ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }
    res.status(200).json({ success: true, data: request, correlationId });
  } catch (error) {
    logger.error(`Error in updateRequestRequestedDetails: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function saveFinalApproval(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    const auditBy = approvalAuditEmployeeCode(req.user?.profile);
    const isSystemAdmin = isSystemAdminRole(req.user?.profile?.ROLE, req.user?.profile?.ROLE_ID);
    if (!Number.isInteger(updatedBy) || !Number.isInteger(auditBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    const request = await requestService.saveFinalApproval(req.params.id, req.body, updatedBy, isSystemAdmin, auditBy);
    res.status(200).json({ success: true, data: request, correlationId });
  } catch (error) {
    logger.error(`Error in saveFinalApproval: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function cloneRequestData(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(updatedBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    const result = await requestService.cloneRequestData(req.params.id, req.body?.sourceRequestId, updatedBy);
    if (!result) {
      const error = new Error(`Request ${req.params.id} or source request was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }
    res.status(200).json({ success: true, data: result, correlationId });
  } catch (error) {
    logger.error(`Error in cloneRequestData: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function cancelRequest(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!Number.isInteger(updatedBy)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const cancelled = await requestService.cancelRequest(req.params.id, updatedBy, req.body?.cancelledNotes);

    if (!cancelled) {
      const error = new Error(`Request ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    await notifyBestEffort({
      event: 'cancel',
      requestId: req.params.id,
      environment: process.env.NODE_ENV,
      actorEmail: req.user?.profile?.EMAIL || req.user?.email,
      actorName: req.user?.profile?.FULL_NAME || req.user?.displayName,
      user: req.user,
    });

    res.status(200).json({ success: true, data: { id: req.params.id }, correlationId });

    logger.debug('Request cancelled', {
      correlationId,
      route: { method: req.method, path: req.path },
      payload: { id: req.params.id, updatedBy },
    });
  } catch (error) {
    logger.error(`Error in cancelRequest: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function sendTestEmail(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const emailModel = await getRequestEmailModel(req.params.id, req.user?.displayName || '-');
    await sendRequestCompletedEmail({
      environment: process.env.NODE_ENV,
      emailModel,
      subject: 'Test Email',
      actorEmail: req.user?.profile?.EMAIL || req.user?.email,
      recipients: {
        to: req.body?.to,
        cc: req.body?.cc,
      },
      requestId: req.params.id,
      user: req.user,
    });

    res.status(200).json({ success: true, data: { id: req.params.id }, correlationId });
  } catch (error) {
    logger.error(`Error in sendTestEmail: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

module.exports = {
  listRequests,
  getRequest,
  suggestRequestCustomerInfo,
  updateRequestCustomerInfo,
  updateRequestCreditSuggestion,
  updateRequestScoringAndPayment,
  updateRequestRequestedDetails,
  saveFinalApproval,
  cloneRequestData,
  cancelRequest,
  sendTestEmail,
};
