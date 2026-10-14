const approverService = require('../services/approverService');
const { isAdminRole } = require('../helpers/roleAuthorization');
const { effectiveEmployeeCode } = require('../helpers/userIdentity');

function requireSystemAdmin(req) {
  const profile = req.user?.profile;
  if (isAdminRole(profile?.ROLE, profile?.ROLE_ID)) return;
  const error = new Error('Only the System Admin or Super User role can manage approvers.');
  error.statusCode = 403;
  error.code = 'FORBIDDEN';
  throw error;
}

function actorCode(req) {
  return effectiveEmployeeCode(req.user?.profile);
}

function requireActorCode(req) {
  const value = actorCode(req);
  if (!value) {
    const error = new Error('Authenticated user profile is missing an employee code.');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
  return value;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function parsePayload(body) {
  const employeeCode = String(body?.employeeCode ?? '').trim();
  const approverTypeId = String(body?.approverTypeId ?? '').trim();
  if (!employeeCode) throw validationError('employeeCode is required.');
  if (!approverTypeId) throw validationError('approverTypeId is required.');
  if (typeof body?.enabled !== 'boolean') throw validationError('enabled must be a boolean.');
  if (body?.primary !== undefined && typeof body.primary !== 'boolean') {
    throw validationError('primary must be a boolean.');
  }
  if (body?.description != null && typeof body.description !== 'string') {
    throw validationError('description must be a string.');
  }
  return {
    employeeCode,
    approverTypeId,
    description: body?.description?.trim() || '',
    enabled: body.enabled,
    primary: body.primary,
  };
}

function sendResult(res, result, resourceName) {
  if (result.kind === 'employee-not-found') throw validationError('The selected employee was not found.');
  if (result.kind === 'employee-name-too-long') throw validationError('The selected employee name exceeds the 50 character limit.');
  if (result.kind === 'approver-type-not-found') throw validationError('The selected approver type is unavailable.');
  if (result.kind === 'inactive') throw validationError('Only active approvers can be set as primary.');
  if (result.kind === 'duplicate') throw validationError('This employee is already assigned as an approver.');
  if (result.kind === 'not-found') {
    const error = new Error(`${resourceName} was not found.`);
    error.statusCode = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }
  return res.status(200).json({ success: true, data: result.item, correlationId: res.locals.correlationId || 'N/A' });
}

async function list(req, res, next) {
  try {
    requireSystemAdmin(req);
    const data = await approverService.listApprovers(req.query);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try {
    requireSystemAdmin(req);
    const item = await approverService.getApproverById(req.params.id);
    return sendResult(res, item ? { item } : { kind: 'not-found' }, 'Approver');
  } catch (error) { return next(error); }
}

async function employeeOptions(req, res, next) {
  try {
    requireSystemAdmin(req);
    const data = await approverService.listEmployeeOptions(req.query.search);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function approverTypeOptions(req, res, next) {
  try {
    requireSystemAdmin(req);
    const data = await approverService.listApproverTypeOptions();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  try {
    requireSystemAdmin(req);
    const payload = parsePayload(req.body);
    const updatedBy = requireActorCode(req);
    const result = await approverService.createApprover(
      payload.employeeCode,
      payload.approverTypeId,
      payload.description,
      payload.enabled,
      updatedBy,
      payload.primary,
    );
    return sendResult(res, result, 'Approver');
  } catch (error) { return next(error); }
}

async function update(req, res, next) {
  try {
    requireSystemAdmin(req);
    const payload = parsePayload(req.body);
    const updatedBy = requireActorCode(req);
    const result = await approverService.updateApprover(
      req.params.id,
      payload.employeeCode,
      payload.approverTypeId,
      payload.description,
      payload.enabled,
      updatedBy,
      payload.primary,
    );
    return sendResult(res, result, 'Approver');
  } catch (error) { return next(error); }
}

async function setActive(req, res, next) {
  try {
    requireSystemAdmin(req);
    if (typeof req.body?.enabled !== 'boolean') throw validationError('enabled must be a boolean.');
    const updatedBy = requireActorCode(req);
    const result = await approverService.setActive(req.params.id, req.body.enabled, updatedBy);
    return sendResult(res, result, 'Approver');
  } catch (error) { return next(error); }
}

async function setPrimary(req, res, next) {
  try {
    requireSystemAdmin(req);
    if (req.body?.primary !== undefined && typeof req.body.primary !== 'boolean') {
      throw validationError('primary must be a boolean.');
    }
    const updatedBy = requireActorCode(req);
    const result = await approverService.setPrimary(req.params.id, updatedBy, req.body?.primary ?? true);
    return sendResult(res, result, 'Approver');
  } catch (error) { return next(error); }
}

async function remove(req, res, next) {
  try {
    requireSystemAdmin(req);
    const updatedBy = requireActorCode(req);
    const result = await approverService.softDelete(req.params.id, updatedBy);
    return sendResult(res, result, 'Approver');
  } catch (error) { return next(error); }
}

module.exports = { list, get, employeeOptions, approverTypeOptions, create, update, setActive, setPrimary, remove };
