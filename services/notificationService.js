const { v4: uuidv4 } = require('uuid');
const { getModels } = require('../models');
const { formatThaiDateTime } = require('../helpers/thaiDateTime');
const { employeeCode } = require('../helpers/userIdentity');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const APPROVER_EVENTS = new Set(['submit', 'approve', 'final']);

const EVENT_TITLES = {
  submit: 'New request for your approval',
  approve: 'New request for your approval',
  final: 'Request approved by all approvers',
  completed: 'Request was completed',
  reject: 'Request was rejected',
  backward: 'Request was sent backward',
  cancel: 'Request was cancelled',
  'final-cancel': 'Request was cancelled',
};

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'BAD_REQUEST';
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = 'NOT_FOUND';
  return error;
}

function requireEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw badRequest('Current user email is not available.');
  return normalized;
}

function cleanValue(value) {
  const text = String(value ?? '').trim();
  return text && text !== '-' ? text : '';
}

function buildMessage(emailModel = {}, actorName) {
  const requestNo = cleanValue(emailModel.requestNo);
  const company = cleanValue(emailModel.companyName);
  const salesGroup = cleanValue(emailModel.salesGroup);
  const subject = [requestNo, company].filter(Boolean).join(' ');
  const parts = [salesGroup ? `${subject || 'Request'} (${salesGroup})` : subject || 'Request'];
  const actor = cleanValue(actorName);
  if (actor) parts.push(`by ${actor}`);
  return parts.join(' ').slice(0, 2048);
}

function collectRecipients(toRecords = [], ccRecords = [], actorEmail) {
  const actor = normalizeEmail(actorEmail);
  const recipients = new Map();
  const add = (record, type) => {
    const email = normalizeEmail(record?.email);
    if (!email || email === actor) return;
    const existing = recipients.get(email);
    if (existing) {
      if (type === 'TO') existing.type = 'TO';
      if (!existing.name && record?.name) existing.name = String(record.name).trim();
      return;
    }
    recipients.set(email, { email, name: String(record?.name || '').trim(), type });
  };
  toRecords.forEach((record) => add(record, 'TO'));
  ccRecords.forEach((record) => add(record, 'CC'));
  return [...recipients.values()];
}

function notificationTab(event, recipientType) {
  if (event === 'backward') return 'credit-request-form';
  return recipientType === 'TO' && APPROVER_EVENTS.has(event) ? 'approver' : 'customers';
}

async function createWorkflowNotifications({ event, requestId, toRecords, ccRecords, actorEmail, actorName, actorCode, emailModel }) {
  const recipients = collectRecipients(toRecords, ccRecords, actorEmail);
  if (!recipients.length) return [];
  const auditCode = employeeCode(actorCode);
  if (auditCode === null) throw new Error('Actor user code is required to create notifications.');
  const { Notification } = getModels();
  const now = Notification.sequelize.literal('GETDATE()');
  const title = EVENT_TITLES[event] || 'Request updated';
  const message = buildMessage(emailModel, actorName);
  const requestNo = cleanValue(emailModel?.requestNo) || null;
  return Notification.bulkCreate(recipients.map((recipient) => ({
    ID: uuidv4(),
    RECIPIENT_EMAIL: recipient.email,
    RECIPIENT_NAME: recipient.name || null,
    RECIPIENT_TYPE: recipient.type,
    REQUEST_ID: requestId ? String(requestId) : null,
    REQUEST_NO: requestNo,
    EVENT_TYPE: event,
    TITLE: title,
    MESSAGE: message,
    TAB: notificationTab(event, recipient.type),
    ACTOR_EMAIL: normalizeEmail(actorEmail) || null,
    ACTOR_NAME: cleanValue(actorName) || null,
    IS_READ: false,
    READ_DATE: null,
    CREATED_DATE: now,
    UPDATED_DATE: now,
    CREATED_BY: auditCode,
    UPDATED_BY: auditCode,
    ENABLED: true,
    SORTING: null,
  })));
}

function toNotificationSummary(notification) {
  const tab = notification.TAB;
  return {
    id: notification.ID,
    requestId: notification.REQUEST_ID,
    requestNo: notification.REQUEST_NO,
    eventType: notification.EVENT_TYPE,
    recipientType: notification.RECIPIENT_TYPE,
    tab: tab === 'approver' || tab === 'credit-request-form' ? tab : 'customers',
    title: notification.TITLE,
    message: notification.MESSAGE,
    actorName: notification.ACTOR_NAME,
    isRead: Boolean(notification.IS_READ),
    readDate: formatThaiDateTime(notification.READ_DATE),
    createdDate: formatThaiDateTime(notification.CREATED_DATE),
  };
}

async function countUnread(email) {
  const { Notification } = getModels();
  return Notification.count({ where: { RECIPIENT_EMAIL: requireEmail(email), ENABLED: true, IS_READ: false } });
}

async function listForUser(email, query = {}) {
  const recipientEmail = requireEmail(email);
  const { Notification } = getModels();
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);
  const where = { RECIPIENT_EMAIL: recipientEmail, ENABLED: true };
  const [rows, unreadCount] = await Promise.all([
    Notification.findAll({
      where,
      order: [['CREATED_DATE', 'DESC'], ['ID', 'DESC']],
      limit: limit + 1,
      offset,
    }),
    countUnread(recipientEmail),
  ]);
  return {
    items: rows.slice(0, limit).map(toNotificationSummary),
    unreadCount,
    hasMore: rows.length > limit,
  };
}

async function markRead(id, email) {
  const recipientEmail = requireEmail(email);
  if (!String(id || '').trim()) throw badRequest('Notification id is required.');
  const { Notification } = getModels();
  const notification = await Notification.findOne({ where: { ID: String(id), RECIPIENT_EMAIL: recipientEmail, ENABLED: true } });
  if (!notification) throw notFound('Notification not found.');
  if (!notification.IS_READ) {
    const now = Notification.sequelize.literal('GETDATE()');
    await notification.update({ IS_READ: true, READ_DATE: now, UPDATED_DATE: now });
  }
  return { id: notification.ID, unreadCount: await countUnread(recipientEmail) };
}

async function markUnread(id, email) {
  const recipientEmail = requireEmail(email);
  if (!String(id || '').trim()) throw badRequest('Notification id is required.');
  const { Notification } = getModels();
  const notification = await Notification.findOne({ where: { ID: String(id), RECIPIENT_EMAIL: recipientEmail, ENABLED: true } });
  if (!notification) throw notFound('Notification not found.');
  if (notification.IS_READ) {
    const now = Notification.sequelize.literal('GETDATE()');
    await notification.update({ IS_READ: false, READ_DATE: null, UPDATED_DATE: now });
  }
  return { id: notification.ID, unreadCount: await countUnread(recipientEmail) };
}

async function markAllRead(email) {
  const recipientEmail = requireEmail(email);
  const { Notification } = getModels();
  const now = Notification.sequelize.literal('GETDATE()');
  const [updated] = await Notification.update(
    { IS_READ: true, READ_DATE: now, UPDATED_DATE: now },
    { where: { RECIPIENT_EMAIL: recipientEmail, ENABLED: true, IS_READ: false } },
  );
  return { updated, unreadCount: 0 };
}

module.exports = {
  collectRecipients,
  createWorkflowNotifications,
  countUnread,
  listForUser,
  markRead,
  markUnread,
  markAllRead,
};
