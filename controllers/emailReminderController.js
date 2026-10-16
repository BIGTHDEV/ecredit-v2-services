const service = require('../services/emailReminderConfigService');
const { isAdminRole } = require('../helpers/roleAuthorization');
const { effectiveEmployeeCode } = require('../helpers/userIdentity');

function requireAdmin(req) {
  if (!isAdminRole(req.user?.profile?.ROLE, req.user?.profile?.ROLE_ID)) {
    const error = new Error('Only the System Admin or Super User role can manage email reminders.');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
}

async function list(req, res, next) {
  try {
    requireAdmin(req);
    const data = await service.listSettings();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    requireAdmin(req);
    const actorCode = effectiveEmployeeCode(req.user?.profile);
    if (actorCode === null) {
      const error = new Error('Authenticated user profile is missing an employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    const data = await service.updateSettings(req.params.template, req.body, actorCode);
    res.json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

module.exports = { list, update };
