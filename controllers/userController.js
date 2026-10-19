const logger = require('../config/logger');
const userService = require('../services/userService');
const permissionService = require('../services/permissionService');
const { isAdminRole } = require('../helpers/roleAuthorization');
const { effectiveEmployeeCode, mainEmployeeCode } = require('../helpers/userIdentity');

function requireSystemAdmin(req) {
  const profile = req.user?.profile;
  if (isAdminRole(profile?.ROLE, profile?.ROLE_ID)) return;
  const error = new Error('Only the System Admin or Super User role can manage users.');
  error.statusCode = 403;
  error.code = 'FORBIDDEN';
  throw error;
}

function requireLoggedInSystemAdmin(req) {
  const profile = req.user?.profile;
  if (isAdminRole(profile?.LOGGED_IN_ROLE, profile?.LOGGED_IN_ROLE_ID)) return;
  const error = new Error('Only the System Admin or Super User role can manage users.');
  error.statusCode = 403;
  error.code = 'FORBIDDEN';
  throw error;
}

function actorCode(req) {
  return effectiveEmployeeCode(req.user?.profile);
}

function mainActorCode(req) {
  return mainEmployeeCode(req.user?.profile);
}

function requireNotLoggedInUser(req, targetCode) {
  const loggedInCode = mainActorCode(req);
  if (loggedInCode && String(loggedInCode) === String(targetCode)) {
    const error = new Error('You cannot modify your own user account.');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
}

function requireSelfAccountActive(req, targetCode, enabled) {
  const loggedInCode = mainActorCode(req);
  if (enabled === false && loggedInCode && String(loggedInCode) === String(targetCode)) {
    const error = new Error('You cannot set your own account inactive.');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
}

function validatePermissionSelections(selections) {
  return Array.isArray(selections) && selections.length > 0 && selections.every((selection) => (
    selection && typeof selection.NAME === 'string' && selection.NAME.length > 0 && typeof selection.GRANTED === 'boolean'
  ));
}

async function listUsers(req, res, next) {
  try {
    requireSystemAdmin(req);
    const data = await userService.listUsers(req.query);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function updateSystemActive(req, res, next) {
  try {
    requireSystemAdmin(req);
    requireNotLoggedInUser(req, req.params.code);
    await userService.assertUserRoleLevelAllowed(actorCode(req), req.params.code);
    if (typeof req.body?.enabled !== 'boolean') {
      const error = new Error('Request body must include boolean "enabled".');
      error.statusCode = 400; error.code = 'VALIDATION_ERROR'; throw error;
    }
    const updatedBy = actorCode(req);
    if (!updatedBy) { const error = new Error('Authenticated user profile is missing an employee code.'); error.statusCode = 403; error.code = 'FORBIDDEN'; throw error; }
    const updated = await userService.setSystemActive(req.params.code, req.body.enabled, updatedBy);
    if (!updated) { const error = new Error(`User ${req.params.code} was not found.`); error.statusCode = 404; error.code = 'RESOURCE_NOT_FOUND'; throw error; }
    res.status(200).json({ success: true, data: { CODE: req.params.code, SYSTEM_ACTIVE: req.body.enabled }, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function getUserDetail(req, res, next) {
  try {
    requireSystemAdmin(req);
    await userService.assertUserRoleLevelAllowed(actorCode(req), req.params.code);
    const data = await userService.getUserDetail(req.params.code);
    if (!data) { const error = new Error(`User ${req.params.code} was not found.`); error.statusCode = 404; error.code = 'RESOURCE_NOT_FOUND'; throw error; }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function getUserPermissions(req, res, next) {
  try {
    requireSystemAdmin(req);
    await userService.assertUserRoleLevelAllowed(actorCode(req), req.params.code);
    const user = await userService.getUserDetail(req.params.code);
    if (!user) { const error = new Error(`User ${req.params.code} was not found.`); error.statusCode = 404; error.code = 'RESOURCE_NOT_FOUND'; throw error; }
    const permissions = await permissionService.getEffectivePermissions(req.params.code);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data: { permissions }, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function updateUserPermissions(req, res, next) {
  try {
    requireSystemAdmin(req);
    await userService.assertUserRoleLevelAllowed(actorCode(req), req.params.code);
    const selections = req.body?.permissions;
    if (!validatePermissionSelections(selections)) { const error = new Error('Request body must include a non-empty "permissions" array of { NAME, GRANTED } items.'); error.statusCode = 400; error.code = 'VALIDATION_ERROR'; throw error; }
    const user = await userService.getUserDetail(req.params.code);
    if (!user) { const error = new Error(`User ${req.params.code} was not found.`); error.statusCode = 404; error.code = 'RESOURCE_NOT_FOUND'; throw error; }
    const permissions = await permissionService.updateUserPermissionOverrides(req.params.code, selections);
    logger.info('User permissions updated', { correlationId: res.locals.correlationId, actorCode: actorCode(req), targetCode: req.params.code, count: selections.length });
    res.status(200).json({ success: true, data: { permissions }, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function setViewAs(req, res, next) {
  try {
    requireLoggedInSystemAdmin(req);
    const updatedBy = mainActorCode(req);
    if (!updatedBy) { const error = new Error('Authenticated user profile is missing an employee code.'); error.statusCode = 403; error.code = 'FORBIDDEN'; throw error; }
    await userService.setViewAs(updatedBy, req.params.code);
    logger.info('View As started', { correlationId: res.locals.correlationId, actorCode: updatedBy, targetCode: req.params.code });
    res.status(200).json({ success: true, data: { VIEW_AS_CODE: req.params.code }, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function clearViewAs(req, res, next) {
  try {
    requireLoggedInSystemAdmin(req);
    const updatedBy = mainActorCode(req);
    if (!updatedBy) { const error = new Error('Authenticated user profile is missing an employee code.'); error.statusCode = 403; error.code = 'FORBIDDEN'; throw error; }
    await userService.clearViewAs(updatedBy);
    logger.info('View As cleared', { correlationId: res.locals.correlationId, actorCode: updatedBy });
    res.status(200).json({ success: true, data: { VIEW_AS_CODE: '' }, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function listEmployeeOptions(req, res, next) {
  try {
    requireSystemAdmin(req);
    const data = await userService.listAvailableEmployees(req.query.search);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function listRoleOptions(req, res, next) {
  try {
    requireSystemAdmin(req);
    const data = await userService.listRoleOptions();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function listPermissionOptions(req, res, next) {
  try {
    requireSystemAdmin(req);
    const data = await userService.listPermissionOptions();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function createUser(req, res, next) {
  try {
    requireSystemAdmin(req);
    const employeeCode = String(req.body?.employeeCode ?? '').trim();
    const roleIds = req.body?.roleIds;
    const permissionIds = req.body?.permissionIds;
    const invalid = (message) => { const error = new Error(message); error.statusCode = 400; error.code = 'VALIDATION_ERROR'; return error; };
    if (!employeeCode) throw invalid('employeeCode is required.');
    if (!Array.isArray(roleIds) || !roleIds.length || !roleIds.every((id) => typeof id === 'string' && id.trim())) throw invalid('roleIds must be a non-empty array of role IDs.');
    if (!Array.isArray(permissionIds) || !permissionIds.every((id) => typeof id === 'string' && id.trim())) throw invalid('permissionIds must be an array of permission IDs.');
    if (typeof req.body?.enabled !== 'boolean') throw invalid('enabled must be a boolean.');
    const createdBy = actorCode(req);
    if (!createdBy) { const error = new Error('Authenticated user profile is missing an employee code.'); error.statusCode = 403; error.code = 'FORBIDDEN'; throw error; }
    const data = await userService.createUser(employeeCode, roleIds, permissionIds, req.body.enabled, createdBy);
    logger.info('User created', { correlationId: res.locals.correlationId, actorCode: createdBy, targetCode: employeeCode, roleIds, permissionCount: permissionIds.length });
    res.status(201).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function updateUserAccess(req, res, next) {
  try {
    requireSystemAdmin(req);
    const roleIds = req.body?.roleIds;
    const permissionIds = req.body?.permissionIds;
    const invalid = (message) => { const error = new Error(message); error.statusCode = 400; error.code = 'VALIDATION_ERROR'; return error; };
    if (!Array.isArray(roleIds) || !roleIds.length || !roleIds.every((id) => typeof id === 'string' && id.trim())) throw invalid('roleIds must be a non-empty array of role IDs.');
    if (!Array.isArray(permissionIds) || !permissionIds.every((id) => typeof id === 'string' && id.trim())) throw invalid('permissionIds must be an array of permission IDs.');
    if (typeof req.body?.enabled !== 'boolean') throw invalid('enabled must be a boolean.');
    requireSelfAccountActive(req, req.params.code, req.body.enabled);
    const updatedBy = actorCode(req);
    if (!updatedBy) { const error = new Error('Authenticated user profile is missing an employee code.'); error.statusCode = 403; error.code = 'FORBIDDEN'; throw error; }
    const data = await userService.updateUserAccess(req.params.code, roleIds, permissionIds, req.body.enabled, updatedBy);
    logger.info('User access updated', { correlationId: res.locals.correlationId, actorCode: updatedBy, targetCode: req.params.code, roleIds, permissionCount: permissionIds.length });
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

module.exports = { listUsers, updateSystemActive, getUserDetail, getUserPermissions, updateUserPermissions, setViewAs, clearViewAs, listEmployeeOptions, listRoleOptions, listPermissionOptions, createUser, updateUserAccess };
