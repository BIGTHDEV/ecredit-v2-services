const { getModels } = require('../models');

const TEMPLATES = ['request-approval', 'request-backward', 'request-draft', 'request-final'];
const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 };

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function validateSettings(body) {
  if (!Number.isInteger(body?.intervalValue) || body.intervalValue < 1 || body.intervalValue > 365) {
    throw validationError('Interval must be a whole number between 1 and 365.');
  }
  if (!Object.hasOwn(UNIT_MINUTES, body?.intervalUnit)) {
    throw validationError('Interval unit must be minutes, hours or days.');
  }
  if (typeof body?.enabled !== 'boolean') throw validationError('enabled must be a boolean.');
  return { INTERVAL_VALUE: body.intervalValue, INTERVAL_UNIT: body.intervalUnit, ENABLED: body.enabled };
}

function intervalMilliseconds(config) {
  const settings = validateSettings({
    intervalValue: config.INTERVAL_VALUE,
    intervalUnit: config.INTERVAL_UNIT,
    enabled: config.ENABLED,
  });
  return settings.INTERVAL_VALUE * UNIT_MINUTES[settings.INTERVAL_UNIT] * 60000;
}

function toSummary(row) {
  return {
    id: row.ID,
    template: row.TEMPLATE,
    intervalValue: row.INTERVAL_VALUE,
    intervalUnit: row.INTERVAL_UNIT,
    enabled: row.ENABLED,
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
  const settings = validateSettings(body);
  const { EmailReminderConfig } = getModels();
  const row = await EmailReminderConfig.findOne({ where: { TEMPLATE: template } });
  if (!row) throw new Error('Email reminder configuration is missing. Apply the email reminders database migration.');
  await row.update({
    ...settings,
    UPDATED_BY: actorCode,
    UPDATED_DATE: EmailReminderConfig.sequelize.literal('GETDATE()'),
  });
  return toSummary(row);
}

module.exports = { TEMPLATES, validateSettings, intervalMilliseconds, listSettings, updateSettings };
