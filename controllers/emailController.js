const { getModels } = require('../models');
const emailLogService = require('../services/emailLogService');
const { sendEmail } = require('../services/emailService');
const { getRequestEmailModel } = require('../services/requestEmailModelService');
const { isAdminRole } = require('../helpers/roleAuthorization');

async function listAllEmails(req, res, next) {
  try {
    const profile = req.user?.profile;
    if (!isAdminRole(profile?.ROLE, profile?.ROLE_ID)) {
      const error = new Error('Only the System Admin or Super User role can access all email logs.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    const data = await emailLogService.listAllEmailLogs(req.query);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) {
    next(error);
  }
}

function requestNotFound() {
  const error = new Error('Request was not found.');
  error.statusCode = 404;
  error.code = 'RESOURCE_NOT_FOUND';
  return error;
}

async function ensureRequest(requestId) {
  const { Request } = getModels();
  const request = await Request.findOne({ where: { ID: requestId, ENABLED: true } });
  if (!request) throw requestNotFound();
  return request;
}

async function listRequestEmails(req, res, next) {
  try {
    await ensureRequest(req.params.requestId);
    const data = await emailLogService.listEmailLogs(req.params.requestId, req.query);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) {
    next(error);
  }
}

async function getRequestEmail(req, res, next) {
  try {
    await ensureRequest(req.params.requestId);
    const data = await emailLogService.getEmailLog(req.params.requestId, req.params.emailId);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) {
    next(error);
  }
}

async function resendRequestEmails(req, res, next) {
  try {
    await ensureRequest(req.params.requestId);
    const emailIds = Array.isArray(req.body?.emailIds) ? [...new Set(req.body.emailIds.filter((id) => typeof id === 'string' && id.trim()))] : [];
    if (!emailIds.length || emailIds.length > 50) {
      const error = new Error('emailIds must contain between 1 and 50 email log IDs.');
      error.statusCode = 400;
      error.code = 'INVALID_INPUT';
      throw error;
    }
    const emailLogs = await emailLogService.findEmailLogs(req.params.requestId, emailIds);
    if (emailLogs.length !== emailIds.length) {
      const error = new Error('One or more email logs do not belong to this request.');
      error.statusCode = 400;
      error.code = 'INVALID_INPUT';
      throw error;
    }

    const results = [];
    for (const emailLog of emailLogs) {
      const payload = emailLogService.parseDescription(emailLog.DESCRIPTION);
      try {
        const sendParameters = payload.sendParameters || payload;
        const recipients = sendParameters.recipients || { to: [], cc: [] };
        const currentModel = await getRequestEmailModel(req.params.requestId, req.user?.displayName || '-');
        const result = await sendEmail({
          template: sendParameters.template || emailLog.CATEGORY,
          subject: sendParameters.baseSubject || sendParameters.subject || emailLog.NAME,
          model: currentModel,
          recipients: {},
          actorEmail: req.user?.email,
          effectiveRecipients: recipients,
          requestId: req.params.requestId,
          user: req.user,
          resendOf: emailLog.ID,
          reminderContext: sendParameters.reminderContext,
        });
        results.push({ id: emailLog.ID, success: true, providerMessageId: result.messageId || null });
      } catch (error) {
        results.push({ id: emailLog.ID, success: false, error: error.message });
      }
    }
    res.status(200).json({ success: true, data: { results }, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) {
    next(error);
  }
}

module.exports = { listAllEmails, listRequestEmails, getRequestEmail, resendRequestEmails };
