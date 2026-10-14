const eventLogService = require('../services/eventLogService');
const { isAdminRole } = require('../helpers/roleAuthorization');

function requireAdmin(req) {
  const profile = req.user?.profile;
  if (isAdminRole(profile?.ROLE, profile?.ROLE_ID)) return;
  const error = new Error('Only the System Admin or Super Admin role can access all event logs.');
  error.statusCode = 403;
  error.code = 'FORBIDDEN';
  throw error;
}

async function listAllEvents(req, res, next) {
  try {
    requireAdmin(req);
    const correlationId = res.locals.correlationId || 'N/A';
    const data = await eventLogService.listAllEvents(req.query);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });
  } catch (error) {
    next(error);
  }
}

async function getAllEvent(req, res, next) {
  try {
    requireAdmin(req);
    const correlationId = res.locals.correlationId || 'N/A';
    const data = await eventLogService.getAllEvent(req.params.logId);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });
  } catch (error) {
    next(error);
  }
}

async function listRequestEvents(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const data = await eventLogService.listRequestEvents(req.params.requestId, req.query);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });
  } catch (error) {
    next(error);
  }
}

async function getRequestEvent(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const data = await eventLogService.getRequestEvent(req.params.requestId, req.params.logId);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });
  } catch (error) {
    next(error);
  }
}

module.exports = { getAllEvent, getRequestEvent, listAllEvents, listRequestEvents };
