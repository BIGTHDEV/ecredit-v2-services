const { v4: uuidv4 } = require('uuid');
const { Op, literal, where: sequelizeWhere } = require('sequelize');
const { getModels } = require('../models');
const { formatThaiDateTime } = require('../helpers/thaiDateTime');
const LOG_TYPE_IDS = require('../constants/logTypeIds');
const { effectiveEmployeeCode, employeeCode: normalizeEmployeeCode } = require('../helpers/userIdentity');
const { createSystemAdminErrorNotifications } = require('./notificationService');

const MAX_DESCRIPTION_BYTES = 1024 * 1024;
const AUTOMATIC_REMINDER_ACTOR = 'System (Auto Reminder)';
const SENSITIVE_KEY = /(password|token|secret|authorization|cookie|api[-_]?key)/i;
const EMAIL_LOG_TYPE_IDS_BY_STATUS = {
  PENDING: LOG_TYPE_IDS.warning,
  SENT: LOG_TYPE_IDS.success,
  FAILED: LOG_TYPE_IDS.error,
};

function emailLogTypeIdForStatus(status) {
  const normalizedStatus = String(status || '').toUpperCase();
  const logTypeId = EMAIL_LOG_TYPE_IDS_BY_STATUS[normalizedStatus];
  if (!logTypeId) throw new Error(`Unsupported email log status: ${normalizedStatus || '(empty)'}.`);
  return logTypeId;
}

function sanitizeValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[omitted]';
  if (typeof value === 'string' && value.length > 512) {
    if (/^[a-z0-9+/=\r\n]+$/i.test(value) && value.length > 256) return `[base64 omitted: ${value.length} chars]`;
    return `${value.slice(0, 512)}... [truncated]`;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeValue(child, childKey)]));
  }
  return value;
}

function parseDescription(description) {
  try {
    return JSON.parse(description || '{}');
  } catch {
    return { raw: description || '' };
  }
}

function employeeCode(user, auditActorCode) {
  return auditActorCode === undefined
    ? effectiveEmployeeCode(user?.profile)
    : normalizeEmployeeCode(auditActorCode);
}

function buildDescription({ status, environment, template, subject, baseSubject, recipients, bcc, model, providerResult, error, resendOf, reminderContext }) {
  const displayPayload = sanitizeValue({
    status,
    environment,
    template,
    subject,
    baseSubject: baseSubject || subject,
    recipients,
    bccCount: Array.isArray(bcc) ? bcc.length : 0,
    providerMessageId: providerResult?.messageId || null,
    providerAccepted: providerResult?.accepted || [],
    providerRejected: providerResult?.rejected || [],
    error: error ? { message: error.message, code: error.code || null } : null,
    resendOf: resendOf || null,
    reminderContext,
  });
  const displayModel = sanitizeValue(model);
  displayPayload.model = displayModel;
  const rawSendParameters = {
    environment,
    template,
    baseSubject: baseSubject || subject,
    subject,
    recipients,
    bcc,
    model,
    reminderContext,
  };
  let serializedDisplay = JSON.stringify(displayPayload);
  if (Buffer.byteLength(serializedDisplay, 'utf8') > MAX_DESCRIPTION_BYTES) {
    serializedDisplay = JSON.stringify({ ...displayPayload, model: '[omitted: display payload exceeded storage limit]', payloadTruncated: true });
  }
  return JSON.stringify({ status, resendOf: resendOf || null, sendParameters: rawSendParameters, displayPayload: JSON.parse(serializedDisplay), providerResult: providerResult ? { messageId: providerResult.messageId || null } : null, error: error ? { message: error.message, code: error.code || null } : null });
}

async function createEmailLog(payload) {
  const logTypeId = emailLogTypeIdForStatus(payload.status);
  const { Email } = getModels();
  const databaseNow = Email.sequelize.literal('GETDATE()');
  return Email.create({
    ID: uuidv4(),
    NAME: payload.subject,
    DESCRIPTION: buildDescription(payload),
    LOG_TYPE_ID: logTypeId,
    REQUEST_ID: payload.requestId || null,
    CATEGORY: payload.template,
    CREATED_DATE: databaseNow,
    UPDATED_DATE: databaseNow,
    CREATED_BY: effectiveEmployeeCode(payload.user?.profile),
    UPDATED_BY: employeeCode(payload.user, payload.auditActorCode),
    ENABLED: true,
    SORTING: 0,
  }, ...(payload.transaction ? [{ transaction: payload.transaction }] : []));
}

async function updateEmailLog(emailLog, payload) {
  const logTypeId = emailLogTypeIdForStatus(payload.status);
  const { Email } = getModels();
  await emailLog.update({
    DESCRIPTION: buildDescription(payload),
    LOG_TYPE_ID: logTypeId,
    UPDATED_DATE: Email.sequelize.literal('GETDATE()'),
    UPDATED_BY: employeeCode(payload.user, payload.auditActorCode),
  }, ...(payload.transaction ? [{ transaction: payload.transaction }] : []));
  if (String(payload.status || '').toUpperCase() === 'FAILED') {
    const profile = payload.user?.profile;
    await createSystemAdminErrorNotifications({
      source: 'Email log',
      requestId: payload.requestId,
      requestNo: payload.model?.requestNo,
      actorEmail: profile?.EMAIL || payload.user?.email,
      actorName: profile?.FULL_NAME || payload.user?.displayName,
      actorCode: payload.auditActorCode === undefined ? effectiveEmployeeCode(profile) : payload.auditActorCode,
      message: `Email delivery failed for ${payload.subject || 'an email'}${payload.error?.message ? `: ${payload.error.message}` : ''}`,
      transaction: payload.transaction,
    });
  }
  return emailLog;
}

function toEmailSummary(emailLog) {
  const payload = parseDescription(emailLog.DESCRIPTION);
  const displayPayload = payload.displayPayload || payload;
  const employee = emailLog.updatedByEmployee;
  const reminderContext = payload.sendParameters?.reminderContext || displayPayload.reminderContext;
  const automaticReminder = reminderContext?.automatic === true
    && (emailLog.UPDATED_BY == null || Number(emailLog.UPDATED_BY) === 0);
  return {
    id: emailLog.ID,
    name: emailLog.NAME,
    category: emailLog.CATEGORY,
    requestId: emailLog.REQUEST_ID,
    actor: employee ? `${employee.INITIALS ?? ''}-${employee.USERNAME ?? ''}` : automaticReminder ? AUTOMATIC_REMINDER_ACTOR : null,
    status: payload.status || displayPayload.status || 'UNKNOWN',
    template: displayPayload.template || payload.template || emailLog.CATEGORY,
    recipients: displayPayload.recipients || payload.recipients || { to: [], cc: [] },
    providerMessageId: payload.providerResult?.messageId || displayPayload.providerMessageId || payload.providerMessageId || null,
    error: payload.error || null,
    createdDate: formatThaiDateTime(emailLog.CREATED_DATE),
    updatedDate: formatThaiDateTime(emailLog.UPDATED_DATE),
  };
}

async function listEmailLogs(requestId, query = {}) {
  const { Email } = getModels();
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 20, 1), 100);
  const where = { REQUEST_ID: requestId, ENABLED: true };
  const requestedStatus = String(query.status || '').toUpperCase();
  const statusMap = { SUCCESS: 'SENT', SENT: 'SENT', ERROR: 'FAILED', FAILED: 'FAILED', PENDING: 'PENDING' };
  if (statusMap[requestedStatus]) where[Op.and] = [literal(`JSON_VALUE([DESCRIPTION], '$.status') = '${statusMap[requestedStatus]}'`)];
  if (query.search) where[Op.or] = [
    { NAME: { [Op.like]: `%${String(query.search).slice(0, 100)}%` } },
    { CATEGORY: { [Op.like]: `%${String(query.search).slice(0, 100)}%` } },
  ];
  const { Employee } = getModels();
  const [rows, totalItems] = await Promise.all([
    Email.findAll({ where, include: [{ model: Employee, as: 'updatedByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false }], order: [['CREATED_DATE', 'DESC']], limit: pageSize, offset: (page - 1) * pageSize }),
    Email.count({ where }),
  ]);
  return { items: rows.map(toEmailSummary), pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } };
}

async function getEmailLog(requestId, emailId) {
  const { Email, Employee } = getModels();
  const emailLog = await Email.findOne({ where: { ID: emailId, REQUEST_ID: requestId, ENABLED: true }, include: [{ model: Employee, as: 'updatedByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false }] });
  if (!emailLog) {
    const error = new Error('Email log was not found.');
    error.statusCode = 404;
    throw error;
  }
  const summary = toEmailSummary(emailLog);
  const storedPayload = parseDescription(emailLog.DESCRIPTION);
  return { ...summary, payload: storedPayload.displayPayload || storedPayload };
}

async function findEmailLogs(requestId, emailIds) {
  const { Email } = getModels();
  return Email.findAll({ where: { ID: emailIds, REQUEST_ID: requestId, ENABLED: true } });
}

function columnFilter(query, key) {
  const value = query[key];
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > 100) {
    const error = new Error(`Email log filter ${key} must be a string of at most 100 characters.`);
    error.statusCode = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }
  return value.trim();
}

async function listAllEmailLogs(query = {}) {
  const { Email, Employee, Request } = getModels();
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize, 10) || 25, 1), 100);
  const where = { ENABLED: true, REQUEST_ID: { [Op.not]: null } };
  const conditions = [];
  const requestFields = ['NO', 'CRM_NO', 'SOLD_TO', 'CUSTOMER_TAX_NO'];
  for (const key of requestFields) {
    const value = columnFilter(query, key);
    if (value) where[`$request.${key}$`] = { [Op.like]: `%${value}%` };
  }
  const name = columnFilter(query, 'name');
  if (name) conditions.push({ [Op.or]: [
    { NAME: { [Op.like]: `%${name}%` } },
    { CATEGORY: { [Op.like]: `%${name}%` } },
  ] });
  const result = columnFilter(query, 'logTypeId').toLowerCase();
  if (result) {
    const labels = { success: EMAIL_LOG_TYPE_IDS_BY_STATUS.SENT, sent: EMAIL_LOG_TYPE_IDS_BY_STATUS.SENT,
      error: EMAIL_LOG_TYPE_IDS_BY_STATUS.FAILED, failed: EMAIL_LOG_TYPE_IDS_BY_STATUS.FAILED,
      pending: EMAIL_LOG_TYPE_IDS_BY_STATUS.PENDING, warning: EMAIL_LOG_TYPE_IDS_BY_STATUS.PENDING };
    where.LOG_TYPE_ID = { [Op.in]: [...new Set(Object.entries(labels)
      .filter(([label, id]) => label.includes(result) || id.includes(result)).map(([, id]) => id))] };
  }
  const date = columnFilter(query, 'createdDate');
  if (date) conditions.push({ [Op.or]: [126, 106, 108].map((style) => sequelizeWhere(
    literal(`CONVERT(NVARCHAR(30), [Email].[CREATED_DATE], ${style})`), { [Op.like]: `%${date}%` },
  )) });
  const actor = columnFilter(query, 'actor');
  const actorExpression = literal(`CASE WHEN [updatedByEmployee].[EMP_CODE] IS NULL
    AND ([Email].[UPDATED_BY] IS NULL OR [Email].[UPDATED_BY] = 0)
    AND COALESCE(
      JSON_VALUE(CASE WHEN ISJSON([Email].[DESCRIPTION]) = 1 THEN [Email].[DESCRIPTION] ELSE '{}' END, '$.sendParameters.reminderContext.automatic'),
      JSON_VALUE(CASE WHEN ISJSON([Email].[DESCRIPTION]) = 1 THEN [Email].[DESCRIPTION] ELSE '{}' END, '$.displayPayload.reminderContext.automatic'),
      JSON_VALUE(CASE WHEN ISJSON([Email].[DESCRIPTION]) = 1 THEN [Email].[DESCRIPTION] ELSE '{}' END, '$.reminderContext.automatic')
    ) = 'true' THEN '${AUTOMATIC_REMINDER_ACTOR}'
    ELSE CONCAT([updatedByEmployee].[INITIALS], '-', [updatedByEmployee].[USERNAME]) END`);
  if (actor) conditions.push(sequelizeWhere(actorExpression, { [Op.like]: `%${actor}%` }));
  if (conditions.length) where[Op.and] = conditions;
  const sortFields = {
    ...Object.fromEntries(requestFields.map((key) => [key, [{ model: Request, as: 'request' }, key]])),
    name: ['NAME'], logTypeId: ['LOG_TYPE_ID'], createdDate: ['CREATED_DATE'], actor: [actorExpression],
  };
  const sort = Object.hasOwn(sortFields, query.sort) ? query.sort : 'createdDate';
  const direction = Object.hasOwn(sortFields, query.sort) && query.dir === 'asc' ? 'ASC' : 'DESC';
  const order = [[...sortFields[sort], direction]];
  if (sort !== 'createdDate') order.push(['CREATED_DATE', 'DESC']);
  order.push(['ID', 'DESC']);
  const { rows, count } = await Email.findAndCountAll({
    where,
    include: [
      { model: Employee, as: 'updatedByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false },
      { model: Request, as: 'request', attributes: requestFields, where: { ENABLED: true }, required: true,
        on: literal('[Email].[REQUEST_ID] COLLATE DATABASE_DEFAULT = [request].[ID] COLLATE DATABASE_DEFAULT') },
    ],
    order, limit: pageSize, offset: (page - 1) * pageSize, distinct: true,
  });
  return {
    items: rows.map((row) => {
      const record = row.get ? row.get({ plain: true }) : row;
      return {
        ...toEmailSummary(record), logTypeId: record.LOG_TYPE_ID, createdBy: record.CREATED_BY,
        ...Object.fromEntries(requestFields.map((key) => [key, record.request?.[key] || ''])),
      };
    }),
    pagination: { page, pageSize, totalItems: count, totalPages: Math.max(1, Math.ceil(count / pageSize)) },
  };
}

module.exports = { sanitizeValue, buildDescription, createEmailLog, updateEmailLog, listEmailLogs, listAllEmailLogs, getEmailLog, findEmailLogs, toEmailSummary, parseDescription };
