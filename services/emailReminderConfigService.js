const { getModels } = require('../models');

const TEMPORARY_TEMPLATE = 'request-temporary';
const TEMPLATES = ['request-approval', 'request-backward', 'request-draft', 'request-final', TEMPORARY_TEMPLATE];
const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 };
const DEFAULT_DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6];

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function validateSettings(body, template) {
  if (!Number.isInteger(body?.intervalValue) || body.intervalValue < 1 || body.intervalValue > 365) {
    throw validationError('Interval must be a whole number between 1 and 365.');
  }
  if (!Object.hasOwn(UNIT_MINUTES, body?.intervalUnit)) {
    throw validationError('Interval unit must be minutes, hours or days.');
  }
  if (typeof body?.enabled !== 'boolean') throw validationError('enabled must be a boolean.');
  const daysOfWeek = body?.daysOfWeek ?? DEFAULT_DAYS_OF_WEEK;
  if (!Array.isArray(daysOfWeek)
    || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    || new Set(daysOfWeek).size !== daysOfWeek.length) {
    throw validationError('daysOfWeek must contain unique weekday numbers from 0 to 6.');
  }
  if (template === TEMPORARY_TEMPLATE
    && (!Number.isInteger(body?.daysBeforeExpiry) || body.daysBeforeExpiry < 1 || body.daysBeforeExpiry > 365)) {
    throw validationError('daysBeforeExpiry must be a whole number between 1 and 365 for request-temporary.');
  }
  return {
    INTERVAL_VALUE: body.intervalValue,
    INTERVAL_UNIT: body.intervalUnit,
    ENABLED: body.enabled,
    DAYS_OF_WEEK: daysOfWeek,
    DAYS_BEFORE_EXPIRY: template === TEMPORARY_TEMPLATE ? body.daysBeforeExpiry : null,
  };
}

function intervalMilliseconds(config) {
  if (!Number.isInteger(config?.INTERVAL_VALUE) || config.INTERVAL_VALUE < 1 || config.INTERVAL_VALUE > 365) {
    throw validationError('Interval must be a whole number between 1 and 365.');
  }
  if (!Object.hasOwn(UNIT_MINUTES, config?.INTERVAL_UNIT)) {
    throw validationError('Interval unit must be minutes, hours or days.');
  }
  if (typeof config?.ENABLED !== 'boolean') throw validationError('enabled must be a boolean.');
  return config.INTERVAL_VALUE * UNIT_MINUTES[config.INTERVAL_UNIT] * 60000;
}

function storedDaysOfWeek(value) {
  let daysOfWeek = value;
  if (typeof value === 'string') {
    try {
      daysOfWeek = JSON.parse(value);
    } catch {
      throw new Error('Stored email reminder weekdays are invalid.');
    }
  }
  if (!Array.isArray(daysOfWeek)
    || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    || new Set(daysOfWeek).size !== daysOfWeek.length) {
    throw new Error('Stored email reminder weekdays are invalid.');
  }
  return daysOfWeek;
}

function toSummary(row) {
  return {
    id: row.ID,
    template: row.TEMPLATE,
    intervalValue: row.INTERVAL_VALUE,
    intervalUnit: row.INTERVAL_UNIT,
    enabled: row.ENABLED,
    daysOfWeek: storedDaysOfWeek(row.DAYS_OF_WEEK),
    daysBeforeExpiry: row.DAYS_BEFORE_EXPIRY == null ? null : row.DAYS_BEFORE_EXPIRY,
  };
}

async function listSettings() {
  const { EmailReminderConfig } = getModels();
  const rows = await EmailReminderConfig.findAll({ order: [['SORTING', 'ASC'], ['TEMPLATE', 'ASC']] });
  if (rows.length !== TEMPLATES.length || TEMPLATES.some((template) => !rows.some((row) => row.TEMPLATE === template))) {
    throw new Error('Email reminder configuration is incomplete. Apply the email reminders database migration.');
  }
  return rows.map(toSummary);
}

async function updateSettings(template, body, actorCode) {
  if (!TEMPLATES.includes(template)) throw validationError('Unsupported reminder template.');
  const settings = validateSettings(body, template);
  const { EmailReminderConfig } = getModels();
  const row = await EmailReminderConfig.findOne({ where: { TEMPLATE: template } });
  if (!row) throw new Error('Email reminder configuration is missing. Apply the email reminders database migration.');
  await row.update({
    ...settings,
    DAYS_OF_WEEK: JSON.stringify(settings.DAYS_OF_WEEK),
    UPDATED_BY: actorCode,
    UPDATED_DATE: EmailReminderConfig.sequelize.literal('GETDATE()'),
  });
  return toSummary(row);
}

module.exports = {
  TEMPORARY_TEMPLATE, TEMPLATES, DEFAULT_DAYS_OF_WEEK, validateSettings, intervalMilliseconds, storedDaysOfWeek, listSettings, updateSettings,
};
