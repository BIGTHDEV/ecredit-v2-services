const logger = require('../../config/logger');
const permissionService = require('../../services/permissionService');
const { isAdminRole } = require('../../helpers/roleAuthorization');

function isValidSelection(selection) {
  return (
    selection &&
    typeof selection.NAME === 'string' &&
    selection.NAME.length > 0 &&
    typeof selection.GRANTED === 'boolean'
  );
}

function requireSystemAdmin(req) {
  const profile = req.user?.profile;
  if (isAdminRole(profile?.ROLE, profile?.ROLE_ID)) {
    return;
  }

  const error = new Error('Only the System Admin or Super User role can update permissions.');
  error.statusCode = 403;
  error.code = 'FORBIDDEN';
  throw error;
}

/**
 * GET /prd/api/permissions/me
 * Returns the full permission catalog with the authenticated user's effective GRANTED state
 */
async function getMyPermissions(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const userId = req.user?.profile?.EFFECTIVE_CODE || req.user?.profile?.CODE;

    if (!userId) {
      const error = new Error('Authenticated user profile is missing an employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const permissions = await permissionService.getEffectivePermissions(userId);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data: { permissions }, correlationId });

    logger.debug('Permissions returned', { correlationId, userId, count: permissions.length });
  } catch (error) {
    logger.error(`Error in getMyPermissions: ${error.message}`, {
      correlationId: res.locals.correlationId,
      stack: error.stack,
    });
    next(error);
  }
}

/**
 * PUT /prd/api/permissions/me
 * Applies checkbox selections to matching ROLE_PERMISSIONS records
 */
async function updateMyPermissions(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const userId = req.user?.profile?.EFFECTIVE_CODE || req.user?.profile?.CODE;

    if (!userId) {
      const error = new Error('Authenticated user profile is missing an employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    requireSystemAdmin(req);

    const selections = req.body?.permissions;
    if (!Array.isArray(selections) || selections.length === 0 || !selections.every(isValidSelection)) {
      const error = new Error('Request body must include a non-empty "permissions" array of { NAME, GRANTED } items.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    const permissions = await permissionService.updateRolePermissions(userId, selections);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data: { permissions }, correlationId });

    logger.debug('Permissions updated', { correlationId, userId, count: selections.length });
  } catch (error) {
    logger.error(`Error in updateMyPermissions: ${error.message}`, {
      correlationId: res.locals.correlationId,
      stack: error.stack,
    });
    next(error);
  }
}

module.exports = {
  getMyPermissions,
  updateMyPermissions,
};
