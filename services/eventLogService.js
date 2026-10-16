const { v4: uuidv4 } = require('uuid');
const { Op, fn, col, literal, where: sequelizeWhere } = require('sequelize');
const logger = require('../config/logger');
const { getModels } = require('../models');
const { formatThaiDateTime } = require('../helpers/thaiDateTime');
const LOG_TYPE_IDS = require('../constants/logTypeIds');
const {
  effectiveEmployeeCode,
  mainEmployeeCode,
  approvalAuditEmployeeCode,
  isMainSystemAdmin,
} = require('../helpers/userIdentity');
const MAX_DESCRIPTION_BYTES = 32 * 1024;

function requestIdFromPath(requestPath) {
  const match = String(requestPath || '').match(/\/requests\/([^/?]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function isEventLogReadRequest(method, requestPath) {
  return (
    String(method).toUpperCase() === 'GET' &&
    /\/requests\/(?:(?:event-logs|email-logs)(?:\/[^/?]+)?|[^/?]+\/event-logs(?:\/[^/?]+)?)\/?(?:\?.*)?$/i.test(String(requestPath || ''))
  );
}

function logTypeForStatus(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warning';
  return 'success';
}

function actionFromRequest(method, requestPath) {
  const normalizedPath = String(requestPath || '')
    .replace(/\?.*$/, '')
    .replace(/^\/(?:dev|qas|prd)\/api\/?/i, '');
  const actionPath = normalizedPath
    .replace(/^requests\/[^/]+\/?/i, 'request ')
    .replace(/\//g, ' ')
    .trim();
  return `${method} ${actionPath || 'api request'}`;
}

function categoryFromPath(requestPath) {
  const normalizedPath = String(requestPath || '')
    .replace(/\?.*$/, '')
    .replace(/^\/(?:dev|qas|prd)\/api\/?/i, '');
  const actionPath = normalizedPath
    .replace(/^requests\/[^/]+\/?/i, 'request/')
    .replace(/\//g, '.')
    .replace(/[^a-z0-9._-]/gi, '')
    .replace(/\.+$/, '');
  return `api${actionPath ? `.${actionPath.toLowerCase()}` : ''}`;
}

function uploadedFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => ({
    name: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  }));
}

function serializeDescription(payload) {
  const redactedPayload = logger.redactPayload(payload);
  let serialized = JSON.stringify(redactedPayload);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_DESCRIPTION_BYTES) return serialized;

  const statusChangeRequestPath = redactedPayload.request?.path;
  const statusChangeReason = typeof statusChangeRequestPath === 'string'
    && /\/requests\/[^/?]+\/status(?:[/?]|\?|$)/i.test(statusChangeRequestPath)
    ? redactedPayload.request.body?.description
    : null;
  const truncatedPayload = {
    correlationId: redactedPayload.correlationId,
    requestId: redactedPayload.requestId,
    actor: redactedPayload.actor,
    ...(typeof statusChangeReason === 'string' && statusChangeReason.trim()
      ? { statusChangeReason: statusChangeReason.trim() }
      : {}),
    request: {
      method: redactedPayload.request.method,
      path: redactedPayload.request.path,
      query: redactedPayload.request.query,
      params: redactedPayload.request.params,
      bodyFields: Object.keys(redactedPayload.request.body || {}),
      ...(redactedPayload.request.body?.approvalCustomization
        ? { approvalCustomization: redactedPayload.request.body.approvalCustomization }
        : {}),
      files: redactedPayload.request.files,
    },
    response: redactedPayload.response,
    payloadTruncated: true,
  };
  serialized = JSON.stringify(truncatedPayload);

  if (Buffer.byteLength(serialized, 'utf8') <= MAX_DESCRIPTION_BYTES) return serialized;
  return JSON.stringify({
    correlationId: redactedPayload.correlationId,
    requestId: redactedPayload.requestId,
    payloadTruncated: true,
    truncationReason: 'Event payload exceeded the maximum storage size.',
  });
}

function isApprovalOrFinalAction(method, requestPath) {
  return ['POST', 'PATCH', 'PUT'].includes(String(method).toUpperCase())
    && /\/requests\/[^/?]+\/(?:approval-action|final-approval)\/?(?:\?.*)?$/i.test(String(requestPath || ''));
}

function normalizePage(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDescription(description) {
  try {
    return JSON.parse(description);
  } catch {
    return { raw: description };
  }
}

function mapEventLog(log, includeDescription = false) {
  const record = log.get ? log.get({ plain: true }) : log;
  const payload = includeDescription ? parseDescription(record.DESCRIPTION) : undefined;
  const employee = record.updatedByEmployee;
  const actor = employee ? `${employee.INITIALS ?? ''}-${employee.USERNAME ?? ''}` : null;

  return {
    id: record.ID,
    name: record.NAME,
    category: record.CATEGORY,
    logTypeId: record.LOG_TYPE_ID,
    createdDate: formatThaiDateTime(record.CREATED_DATE),
    createdBy: record.CREATED_BY,
    actor,
    ...(includeDescription ? { payload } : {}),
  };
}

function mapAllEventLog(log, includeDescription = false) {
  const record = log.get ? log.get({ plain: true }) : log;
  const request = record.request;
  return {
    ...mapEventLog(record, includeDescription),
    requestId: record.REQUEST_ID || '',
    NO: request?.NO || '',
    CRM_NO: request?.CRM_NO || '',
    SOLD_TO: request?.SOLD_TO || '',
    CUSTOMER_TAX_NO: request?.CUSTOMER_TAX_NO || '',
  };
}

async function assertActiveRequest(requestId) {
  const { Request } = getModels();
  const request = await Request.findOne({
    where: { ID: requestId, ENABLED: true },
    attributes: ['ID'],
  });

  if (!request) {
    const error = new Error(`Request ${requestId} was not found.`);
    error.statusCode = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }
}

async function listRequestEvents(requestId, query) {
  await assertActiveRequest(requestId);
  const { Employee, Log } = getModels();
  const page = normalizePage(query.page, 1);
  const pageSize = Math.min(normalizePage(query.pageSize, 20), 100);
  const where = { REQUEST_ID: requestId, ENABLED: true };

  if (Object.values(LOG_TYPE_IDS).includes(query.logTypeId)) {
    where.LOG_TYPE_ID = query.logTypeId;
  }

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search.length > 100) {
    const error = new Error('Event log search must not exceed 100 characters.');
    error.statusCode = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }
  if (search) {
    const searchPattern = `%${search}%`;
    const matchingLogTypeIds = Object.entries(LOG_TYPE_IDS)
      .filter(([label]) => label.includes(search.toLowerCase()))
      .map(([, id]) => id);
    const searchConditions = [
      { NAME: { [Op.like]: searchPattern } },
      { CATEGORY: { [Op.like]: searchPattern } },
      { DESCRIPTION: { [Op.like]: searchPattern } },
      sequelizeWhere(
        fn('CONCAT', col('updatedByEmployee.INITIALS'), '-', col('updatedByEmployee.USERNAME')),
        { [Op.like]: searchPattern },
      ),
    ];
    if (matchingLogTypeIds.length) searchConditions.push({ LOG_TYPE_ID: { [Op.in]: matchingLogTypeIds } });
    where[Op.or] = searchConditions;
  }

  const { count, rows } = await Log.findAndCountAll({
    where,
    include: [{ model: Employee, as: 'updatedByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false }],
    order: [['CREATED_DATE', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    items: rows.map((log) => mapEventLog(log)),
    pagination: {
      page,
      pageSize,
      totalItems: count,
      totalPages: Math.max(1, Math.ceil(count / pageSize)),
    },
  };
}

async function getRequestEvent(requestId, logId) {
  await assertActiveRequest(requestId);
  const { Employee, Log } = getModels();
  const log = await Log.findOne({
    where: { ID: logId, REQUEST_ID: requestId, ENABLED: true },
    include: [{ model: Employee, as: 'updatedByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false }],
  });

  if (!log) {
    const error = new Error(`Event log ${logId} was not found for request ${requestId}.`);
    error.statusCode = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }

  return mapEventLog(log, true);
}

async function listAllEvents(query) {
  const { Employee, Log, Request } = getModels();
  const page = normalizePage(query.page, 1);
  const pageSize = Math.min(normalizePage(query.pageSize, 25), 100);
  const where = { ENABLED: true, REQUEST_ID: { [Op.not]: null } };
  const andConditions = [];
  const requestFilters = {
    NO: 'NO',
    CRM_NO: 'CRM_NO',
    SOLD_TO: 'SOLD_TO',
    CUSTOMER_TAX_NO: 'CUSTOMER_TAX_NO',
  };

  for (const [filterKey, requestField] of Object.entries(requestFilters)) {
    const filter = eventLogColumnFilter(query, filterKey);
    if (filter) where[`$request.${requestField}$`] = { [Op.like]: `%${filter}%` };
  }

  const actionFilter = eventLogColumnFilter(query, 'name');
  if (actionFilter) {
    const pattern = `%${actionFilter}%`;
    andConditions.push({
      [Op.or]: [
        { NAME: { [Op.like]: pattern } },
        { CATEGORY: { [Op.like]: pattern } },
      ],
    });
  }

  const resultFilter = eventLogColumnFilter(query, 'logTypeId');
  if (resultFilter) {
    const normalizedFilter = resultFilter.toLowerCase();
    const matchingTypes = Object.entries(LOG_TYPE_IDS)
      .filter(([label, id]) => label.includes(normalizedFilter) || id.toLowerCase().includes(normalizedFilter))
      .map(([, id]) => id);
    where.LOG_TYPE_ID = { [Op.in]: matchingTypes };
  }

  const dateFilter = eventLogColumnFilter(query, 'createdDate');
  if (dateFilter) {
    const pattern = `%${dateFilter}%`;
    andConditions.push({
      [Op.or]: [
        sequelizeWhere(literal('CONVERT(NVARCHAR(30), [Log].[CREATED_DATE], 126)'), { [Op.like]: pattern }),
        sequelizeWhere(literal('CONVERT(NVARCHAR(30), [Log].[CREATED_DATE], 106)'), { [Op.like]: pattern }),
        sequelizeWhere(literal('CONVERT(NVARCHAR(30), [Log].[CREATED_DATE], 108)'), { [Op.like]: pattern }),
      ],
    });
  }

  const actorFilter = eventLogColumnFilter(query, 'actor');
  if (actorFilter) {
    andConditions.push(sequelizeWhere(
      fn('CONCAT', col('updatedByEmployee.INITIALS'), '-', col('updatedByEmployee.USERNAME')),
      { [Op.like]: `%${actorFilter}%` },
    ));
  }

  if (andConditions.length) where[Op.and] = andConditions;

  const sortableColumns = ['NO', 'CRM_NO', 'SOLD_TO', 'CUSTOMER_TAX_NO', 'logTypeId', 'createdDate', 'actor'];
  const validSort = sortableColumns.includes(query.sort);
  const sortKey = validSort ? query.sort : 'createdDate';
  const sortDirection = validSort && query.dir === 'asc' ? 'ASC' : 'DESC';
  const sortFields = {
    NO: [{ model: Request, as: 'request' }, 'NO'],
    CRM_NO: [{ model: Request, as: 'request' }, 'CRM_NO'],
    SOLD_TO: [{ model: Request, as: 'request' }, 'SOLD_TO'],
    CUSTOMER_TAX_NO: [{ model: Request, as: 'request' }, 'CUSTOMER_TAX_NO'],
    logTypeId: ['LOG_TYPE_ID'],
    createdDate: ['CREATED_DATE'],
    actor: [fn('CONCAT', col('updatedByEmployee.INITIALS'), '-', col('updatedByEmployee.USERNAME'))],
  };
  const sortOrder = [...sortFields[sortKey], sortDirection];
  const order = [sortOrder];
  if (sortKey !== 'createdDate') order.push(['CREATED_DATE', 'DESC']);

  const { count, rows } = await Log.findAndCountAll({
    where,
    include: [
      { model: Employee, as: 'updatedByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false },
      {
        model: Request,
        as: 'request',
        attributes: ['NO', 'CRM_NO', 'SOLD_TO', 'CUSTOMER_TAX_NO'],
        where: { ENABLED: true },
        required: true,
        on: literal('[Log].[REQUEST_ID] COLLATE DATABASE_DEFAULT = [request].[ID] COLLATE DATABASE_DEFAULT'),
      },
    ],
    order,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    distinct: true,
  });

  return {
    items: rows.map((log) => mapAllEventLog(log)),
    pagination: {
      page,
      pageSize,
      totalItems: count,
      totalPages: Math.max(1, Math.ceil(count / pageSize)),
    },
  };
}

async function getAllEvent(logId) {
  const { Employee, Log, Request } = getModels();
  const log = await Log.findOne({
    where: { ID: logId, ENABLED: true },
    include: [{ model: Employee, as: 'updatedByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false }],
  });

  if (!log) {
    const error = new Error(`Event log ${logId} was not found.`);
    error.statusCode = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }

  const request = log.REQUEST_ID
    ? await Request.findOne({
      where: { ID: log.REQUEST_ID },
      attributes: ['ID', 'NO', 'CRM_NO', 'SOLD_TO', 'CUSTOMER_TAX_NO'],
      raw: true,
    })
    : null;
  const record = log.get ? log.get({ plain: true }) : log;
  return mapAllEventLog({ ...record, request }, true);
}

function eventLogColumnFilter(query, key) {
  const value = query[key];
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    const error = new Error(`Event log filter ${key} must be a string.`);
    error.statusCode = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }
  const filter = value.trim();
  if (filter.length > 100) {
    const error = new Error(`Event log filter ${key} must not exceed 100 characters.`);
    error.statusCode = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }
  return filter;
}

async function persistRequestEvent({ req, res, durationMs }) {
  const requestPath = req.originalUrl || req.path;

  if (isEventLogReadRequest(req.method, requestPath)) {
    return;
  }

  const requestId = requestIdFromPath(requestPath);

  const statusCode = res.statusCode;
  const logType = logTypeForStatus(statusCode);
  const profile = req.user?.profile;
  const approvalOrFinalAction = isApprovalOrFinalAction(req.method, requestPath);
  const mainUserAudit = approvalOrFinalAction && isMainSystemAdmin(profile);
  const createdBy = effectiveEmployeeCode(profile);
  const actorCode = approvalOrFinalAction
    ? approvalAuditEmployeeCode(profile)
    : effectiveEmployeeCode(profile);

  if (actorCode === null) {
    return;
  }

  const description = serializeDescription({
    correlationId: res.locals.correlationId || 'N/A',
    requestId,
    actor: {
      employeeCode: actorCode,
      displayName: mainUserAudit
        ? req.user?.displayName || null
        : profile?.FULL_NAME || req.user?.displayName || null,
      email: mainUserAudit
        ? req.user?.email || null
        : profile?.EMAIL || req.user?.email || null,
    },
    ...(profile?.IS_VIEWING_AS ? {
      viewing: {
        mainUser: mainEmployeeCode(profile),
        viewAs: effectiveEmployeeCode(profile),
      },
    } : {}),
    request: {
      method: req.method,
      path: requestPath,
      query: req.query,
      params: { requestId },
      body: req.body || {},
      files: uploadedFiles(req.files),
    },
    ...(Array.isArray(res.locals.outboundRequests) && res.locals.outboundRequests.length > 0
      ? { outboundRequests: res.locals.outboundRequests }
      : {}),
    response: { statusCode, durationMs },
  });

  const { Log } = getModels();
  const databaseNow = Log.sequelize.literal('GETDATE()');
  await Log.create({
    ID: uuidv4(),
    NAME: actionFromRequest(req.method, requestPath),
    DESCRIPTION: description,
    LOG_TYPE_ID: LOG_TYPE_IDS[logType],
    CATEGORY: categoryFromPath(requestPath),
    REQUEST_ID: requestId,
    CREATED_DATE: databaseNow,
    UPDATED_DATE: databaseNow,
    CREATED_BY: createdBy,
    UPDATED_BY: actorCode,
    ENABLED: true,
  });
}

module.exports = {
  LOG_TYPE_IDS,
  getAllEvent,
  getRequestEvent,
  listAllEvents,
  listRequestEvents,
  persistRequestEvent,
  requestIdFromPath,
  serializeDescription,
  isApprovalOrFinalAction,
};
