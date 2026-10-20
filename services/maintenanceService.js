const { getModels } = require('../models');
const { isSystemAdminRole } = require('../helpers/roleAuthorization');

function validationError(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'VALIDATION_ERROR' });
}

function parseTimestamp(value, field) {
  if (value === null) return null;
  const match = typeof value === 'string'
    && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  const date = match && new Date(value);
  if (!match || !Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999
    || Number(match[2]) < 1 || Number(match[2]) > 12
    || Number(match[3]) < 1
    || Number(match[3]) > new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()
    || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) {
    throw validationError(`${field} must be an ISO timestamp with a timezone, or null.`);
  }
  return date;
}

function validateSettings(body) {
  if (typeof body?.enabled !== 'boolean') throw validationError('enabled must be a boolean.');
  if (typeof body.message !== 'string' || body.message.length > 4000) {
    throw validationError('message must be a string of at most 4000 characters.');
  }
  const message = body.message.trim();
  const startsAt = parseTimestamp(body.startsAt, 'startsAt');
  const endsAt = parseTimestamp(body.endsAt, 'endsAt');
  if (body.enabled && (!message || !startsAt || !endsAt)) {
    throw validationError('Enabled maintenance requires a message, startsAt and endsAt.');
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw validationError('endsAt must be later than startsAt.');
  }
  return { ENABLED: body.enabled, MESSAGE: message, STARTS_AT: startsAt, ENDS_AT: endsAt };
}

function canBypass(user) {
  const profile = user?.profile;
  return Boolean(profile && isSystemAdminRole(profile.LOGGED_IN_ROLE, profile.LOGGED_IN_ROLE_ID));
}

function toState(row, user, now = new Date()) {
  const startsAt = row.STARTS_AT === null ? null : new Date(row.STARTS_AT);
  const endsAt = row.ENDS_AT === null ? null : new Date(row.ENDS_AT);
  if ((startsAt && !Number.isFinite(startsAt.getTime())) || (endsAt && !Number.isFinite(endsAt.getTime()))
    || (row.ENABLED && (!startsAt || !endsAt || endsAt <= startsAt || !row.MESSAGE?.trim()))) {
    throw new Error('Maintenance configuration is invalid. Check MAINTENANCE_CONFIG.');
  }
  return {
    enabled: Boolean(row.ENABLED),
    active: Boolean(row.ENABLED && startsAt <= now && now < endsAt),
    message: row.MESSAGE,
    startsAt: startsAt?.toISOString() || null,
    endsAt: endsAt?.toISOString() || null,
    serverTime: now.toISOString(),
    canBypass: canBypass(user),
  };
}

async function getRow() {
  const { MaintenanceConfig } = getModels();
  const row = await MaintenanceConfig.findByPk('system');
  if (!row) throw new Error('Maintenance configuration is missing. Apply the maintenance database migration.');
  return row;
}

async function getState(user) {
  return toState(await getRow(), user);
}

async function updateSettings(body, user) {
  if (!canBypass(user)) {
    throw Object.assign(new Error('Only System Admin can configure maintenance.'), { statusCode: 403, code: 'FORBIDDEN' });
  }
  const actor = user.profile.LOGGED_IN_CODE;
  if (actor === undefined || actor === null || String(actor).trim() === '') {
    throw Object.assign(new Error('Authenticated employee code is missing.'), { statusCode: 403, code: 'FORBIDDEN' });
  }
  const settings = validateSettings(body);
  const row = await getRow();
  const { MaintenanceConfig } = getModels();
  await row.update({
    ...settings,
    UPDATED_BY: actor,
    UPDATED_DATE: MaintenanceConfig.sequelize.literal('SYSUTCDATETIME()'),
  });
  return toState(row, user);
}

module.exports = { validateSettings, toState, canBypass, getState, updateSettings };
