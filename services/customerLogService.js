const { Op, fn, col, where } = require('sequelize');
const { randomUUID } = require('crypto');
const { getModels } = require('../models');
const { formatThaiDateTime } = require('../helpers/thaiDateTime');
const LOG_TYPE_IDS = require('../constants/logTypeIds');

const CUSTOMER_AUDIT_FIELDS = [
  'TAX_NO',
  'REGISTERED_DATE',
  'REGISTERED_CAPITAL_AMOUNT',
  'SIZE_ID',
  'BUSINESS_TYPE_INTER',
  'CUSTOMER_TYPE_INTER',
  'BUSINESS_TYPE_EXTER',
  'CUSTOMER_TYPE_EXTER',
  'SHAREHOLDERS',
  'DIRECTORS',
  'DESCRIPTION',
  'ENABLED',
];

const CUSTOMER_VALUE_FIELDS = CUSTOMER_AUDIT_FIELDS.filter((field) => field !== 'ENABLED' && field !== 'DESCRIPTION');

function plainCustomer(customer) {
  if (!customer) return {};
  return customer.get ? customer.get({ plain: true }) : customer;
}

function auditValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value.fn === 'DATEFROMPARTS' && Array.isArray(value.args)) {
    const [year, month, day] = value.args;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return value;
}

function customerChanges(before, after) {
  const beforeRecord = plainCustomer(before);
  const afterRecord = plainCustomer(after);
  const changes = {};

  CUSTOMER_AUDIT_FIELDS.forEach((field) => {
    const previousValue = auditValue(beforeRecord[field]);
    const nextValue = auditValue(afterRecord[field]);
    if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
      changes[field] = { from: previousValue, to: nextValue };
    }
  });

  return changes;
}

async function recordCustomerMutation({
  customerId,
  taxNo,
  action,
  source,
  requestId,
  actorId,
  before,
  after,
  transaction,
}) {
  const createdBy = Number(actorId);
  if (!Number.isSafeInteger(createdBy)) {
    throw new Error('A valid employee code is required to record a customer log.');
  }
  const { CustomerLog } = getModels();
  const afterRecord = plainCustomer(after);
  const logName = action === 'insert'
    ? 'Customer created'
    : action === 'delete' ? 'Customer deleted' : 'Customer updated';
  const values = Object.fromEntries(CUSTOMER_VALUE_FIELDS.map((field) => [
    field,
    auditValue(afterRecord[field]),
  ]));
  const description = JSON.stringify({
    operation: 'upsert',
    action,
    source,
    customerId: customerId || afterRecord.ID,
    ...(requestId ? { requestId } : {}),
    values: {
      ...values,
      customerDescription: auditValue(afterRecord.DESCRIPTION),
      customerEnabled: auditValue(afterRecord.ENABLED),
    },
    changes: customerChanges(before, after),
  });

  return CustomerLog.create({
    ID: randomUUID(),
    TAX_NO: afterRecord.TAX_NO || taxNo,
    NAME: logName,
    DESCRIPTION: description,
    LOG_TYPE_ID: LOG_TYPE_IDS.success,
    CUSTOMER_ID: customerId || afterRecord.ID,
    CATEGORY: `customer.${action}`,
    CREATED_DATE: CustomerLog.sequelize.fn('GETDATE'),
    UPDATED_DATE: CustomerLog.sequelize.fn('GETDATE'),
    CREATED_BY: createdBy,
    UPDATED_BY: createdBy,
    ENABLED: true,
  }, { transaction });
}

async function recordCompanyInfoLookup({
  customerId,
  taxNo,
  actorId,
  outboundPayload,
  result,
  error,
}) {
  const createdBy = Number(actorId);
  if (!Number.isSafeInteger(createdBy)) {
    throw new Error('A valid employee code is required to record a customer log.');
  }
  const { CustomerLog } = getModels();
  const succeeded = !error;
  const description = JSON.stringify({
    operation: 'lookup',
    action: 'lookup',
    source: 'Find Company Data',
    customerId,
    taxNo,
    status: succeeded ? 'success' : 'failed',
    ...(outboundPayload ? { request: outboundPayload } : {}),
    ...(succeeded
      ? { response: { fields: result?.fields ?? {}, sources: result?.sources ?? [] } }
      : { error: { code: error.code || 'UNKNOWN_ERROR', message: error.message } }),
  });

  return CustomerLog.create({
    ID: randomUUID(),
    TAX_NO: taxNo,
    NAME: succeeded ? 'Company data searched' : 'Company data search failed',
    DESCRIPTION: description,
    LOG_TYPE_ID: succeeded ? LOG_TYPE_IDS.success : LOG_TYPE_IDS.error,
    CUSTOMER_ID: customerId,
    CATEGORY: 'customer.company-info-lookup',
    CREATED_DATE: CustomerLog.sequelize.fn('GETDATE'),
    UPDATED_DATE: CustomerLog.sequelize.fn('GETDATE'),
    CREATED_BY: createdBy,
    UPDATED_BY: createdBy,
    ENABLED: true,
  });
}

function normalizePage(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function mapCustomerLog(log, includeDescription = false) {
  const record = log.get ? log.get({ plain: true }) : log;
  const employee = record.createdByEmployee;
  const actor = employee ? `${employee.INITIALS ?? ''}-${employee.USERNAME ?? ''}` : null;
  const payload = parseDescription(record.DESCRIPTION);

  return {
    id: record.ID,
    taxNo: record.TAX_NO,
    action: payload.action || 'upsert',
    source: payload.source || record.CATEGORY || '',
    createdDate: formatThaiDateTime(record.CREATED_DATE),
    createdBy: record.CREATED_BY,
    actor,
    ...(includeDescription ? { description: record.DESCRIPTION } : {}),
  };
}

function parseDescription(description) {
  if (typeof description !== 'string' || !description) return {};
  try {
    const payload = JSON.parse(description);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

async function assertActiveCustomer(customerId) {
  const { Customer } = getModels();
  const customer = await Customer.findOne({
    where: { ID: customerId, ENABLED: '1' },
    attributes: ['ID'],
  });

  if (!customer) {
    const error = new Error(`Customer ${customerId} was not found.`);
    error.statusCode = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }
  return customer;
}

async function listCustomerLogs(customerId, query) {
  await assertActiveCustomer(customerId);
  const { CustomerLog, Employee, LogType } = getModels();
  const page = normalizePage(query.page, 1);
  const pageSize = Math.min(normalizePage(query.pageSize, 20), 100);
  const whereClause = {
    CUSTOMER_ID: customerId,
    ENABLED: true,
  };
  const search = typeof query.search === 'string' ? query.search.trim() : '';

  if (search.length > 100) {
    const error = new Error('Customer log search must not exceed 100 characters.');
    error.statusCode = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }
  if (search) {
    const searchPattern = `%${search}%`;
    whereClause[Op.and] = [{
      [Op.or]: [
        { TAX_NO: { [Op.like]: searchPattern } },
        { NAME: { [Op.like]: searchPattern } },
        { CATEGORY: { [Op.like]: searchPattern } },
        { DESCRIPTION: { [Op.like]: searchPattern } },
        { LOG_TYPE_ID: { [Op.like]: searchPattern } },
        where(fn('CONCAT', col('createdByEmployee.INITIALS'), '-', col('createdByEmployee.USERNAME')), {
          [Op.like]: searchPattern,
        }),
        where(col('logType.NAME'), { [Op.like]: searchPattern }),
      ],
    }];
  }

  const { count, rows } = await CustomerLog.findAndCountAll({
    where: whereClause,
    include: [
      { model: Employee, as: 'createdByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false },
      { model: LogType, as: 'logType', attributes: ['NAME'], required: false },
    ],
    order: [['CREATED_DATE', 'DESC'], ['SORTING', 'ASC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    items: rows.map((log) => mapCustomerLog(log)),
    pagination: {
      page,
      pageSize,
      totalItems: count,
      totalPages: Math.max(1, Math.ceil(count / pageSize)),
    },
  };
}

async function getCustomerLog(customerId, logId) {
  await assertActiveCustomer(customerId);
  const { CustomerLog, Employee, LogType } = getModels();
  const log = await CustomerLog.findOne({
    where: { ID: logId, CUSTOMER_ID: customerId, ENABLED: true },
    include: [
      { model: Employee, as: 'createdByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false },
      { model: LogType, as: 'logType', attributes: ['NAME'], required: false },
    ],
  });

  if (!log) {
    const error = new Error(`Customer log ${logId} was not found for customer ${customerId}.`);
    error.statusCode = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }

  return mapCustomerLog(log, true);
}

module.exports = {
  assertActiveCustomer,
  getCustomerLog,
  listCustomerLogs,
  recordCompanyInfoLookup,
  recordCustomerMutation,
};
