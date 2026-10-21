const { Op, QueryTypes, fn, col, where } = require('sequelize');
const { randomUUID } = require('crypto');
const { getModels } = require('../models');
const { getDatabase } = require('../config/database');
const attachmentService = require('./attachmentService');
const customerLogService = require('./customerLogService');
const { propagateApprovedValues } = require('./approvalWorkflowService');

const QUICK_FILTERS = new Set(['rating', 'limit', 'term']);
const DRAFT_STATUS_ID = 'db8b3768-8466-4974-8dff-4c374b16a639';
const CANCELLED_STATUS_ID = '31d531f4-0420-4db5-aecf-bcfe4a0e8c4a';
const COMPLETED_STATUS_ID = '407e23f9-caf5-4c4a-801d-598cf437d1ae';
const WAITING_APPROVAL_STATUS_ID = '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b';
const FINAL_STATUS_ID = '014e8e8b-42cf-4b2f-8cae-e395e26efbcd';
const REJECTED_STATUS_ID = '94589a22-12e5-4298-aa30-06295acbe1b9';
const PENDING_APPROVAL_TYPE_ID = 'b4c27a6c-ab7c-4ce5-b885-997f9104c23d';
const APPROVED_APPROVAL_TYPE_ID = 'aab5ce03-1c54-48c8-8305-6b1a017b43fd';
const BACKWARD_APPROVAL_TYPE_ID = 'b76065cc-6507-458d-94ce-87231cbaa57c';
const SMALL_CUSTOMER_SIZE_ID = 'd8ce72cf-0228-4293-9699-311eeecb926d';
const MEDIUM_CUSTOMER_SIZE_ID = '9d9d84c7-8926-4629-b06f-2cb4d434fc33';
const LARGE_CUSTOMER_SIZE_ID = '4b2d23db-96d6-4cef-b6ae-10a97a8ce1cb';
const MAX_RICH_TEXT_SIZE = 8 * 1024 * 1024; // 8 MiB
const MEDIUM_CUSTOMER_CAPITAL_MINIMUM = 50000000n;
const LARGE_CUSTOMER_CAPITAL_MINIMUM = 200000000n;
const SORT_FIELDS = {
  NO: 'NO',
  CUSTOMER_NAME_TH: 'CUSTOMER_NAME_TH',
  CUSTOMER_NAME_ENG: 'CUSTOMER_NAME_ENG',
  CUSTOMER_SALES_GROUP: 'REQUESTED_SALES_GROUP',
  CRM_NO: 'CRM_NO',
  SUBJECT: 'DESCRIPTION',
  SOLD_TO: 'SOLD_TO',
  SEARCH_TERM: 'SEARCH_TERM',
  REQUESTED_LIMIT: 'REQUESTED_LIMIT_AMOUNT',
  APPROVED_LIMIT: 'APPROVED_LIMIT_AMOUNT',
  UPDATED_DATE: 'UPDATED_DATE',
};
const APPROVAL_ACTION_TYPES = {
  approve: 'Approved',
  reject: 'Rejected',
};

const TEXT_FILTERS = {
  NO: 'NO',
  CUSTOMER_NAME_TH: 'CUSTOMER_NAME_TH',
  CUSTOMER_NAME_ENG: 'CUSTOMER_NAME_ENG',
  CUSTOMER_SALES_GROUP: 'REQUESTED_SALES_GROUP',
  CRM_NO: 'CRM_NO',
  SUBJECT: 'DESCRIPTION',
  SOLD_TO: 'SOLD_TO',
  CUSTOMER_TAX_NO: 'CUSTOMER_TAX_NO',
  SEARCH_TERM: 'SEARCH_TERM',
};

const RELATED_TEXT_FILTERS = {
  SAP_STATUS: ['sapStatus', 'NAME'],
  REQUESTED_RATING: ['requestedRating', 'NAME'],
  REQUESTED_TERM: ['requestedTerm', 'NAME'],
  APPROVED_RATING: ['approvedRating', 'NAME'],
  APPROVED_TERM: ['approvedTerm', 'NAME'],
  STATUS: ['status', 'NAME'],
};

function normalizePage(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeQuickFilters(value) {
  const filters = Array.isArray(value) ? value : value ? [value] : [];
  const unsupported = filters.find((filter) => !QUICK_FILTERS.has(filter));

  if (unsupported) {
    const error = new Error(`Unsupported quick filter: ${unsupported}`);
    error.statusCode = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }

  return [...new Set(filters)];
}

function nonBlankName(modelAlias) {
  return where(fn('LTRIM', fn('RTRIM', col(`${modelAlias}.NAME`))), { [Op.ne]: '' });
}

function buildWhere(query) {
  const conditions = [{ ENABLED: true }];

  const relatedCustomerNo = typeof query.relatedCustomerNo === 'string' ? query.relatedCustomerNo.trim() : '';
  const relatedTaxId = typeof query.relatedTaxId === 'string' ? query.relatedTaxId.trim() : '';
  const relatedCustomerConditions = [];
  if (relatedCustomerNo) relatedCustomerConditions.push({ SOLD_TO: relatedCustomerNo });
  if (relatedTaxId) relatedCustomerConditions.push({ CUSTOMER_TAX_NO: relatedTaxId });
  if (relatedCustomerConditions.length) {
    conditions.push({ [Op.or]: relatedCustomerConditions });
  }

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push({
      [Op.or]: [
        { NO: { [Op.like]: searchPattern } },
        { SOLD_TO: { [Op.like]: searchPattern } },
        { CRM_NO: { [Op.like]: searchPattern } },
        { CUSTOMER_NAME_TH: { [Op.like]: searchPattern } },
        { CUSTOMER_NAME_ENG: { [Op.like]: searchPattern } },
        { CUSTOMER_TAX_NO: { [Op.like]: searchPattern } },
      ],
    });
  }

  Object.entries(TEXT_FILTERS).forEach(([queryKey, column]) => {
    const value = typeof query[queryKey] === 'string' ? query[queryKey].trim() : '';
    if (value) {
      conditions.push({ [column]: { [Op.like]: `%${value}%` } });
    }
  });

  Object.entries(RELATED_TEXT_FILTERS).forEach(([queryKey, [modelAlias, column]]) => {
    const value = typeof query[queryKey] === 'string' ? query[queryKey].trim() : '';
    if (value) {
      const filterValue = queryKey === 'SAP_STATUS' && value === '-' ? 'Waiting-Approval' : value;
      conditions.push(where(col(`${modelAlias}.${column}`), { [Op.like]: `%${filterValue}%` }));
    }
  });

  ['REQUESTED_LIMIT', 'APPROVED_LIMIT'].forEach((queryKey) => {
    const value = typeof query[queryKey] === 'string' ? query[queryKey].trim() : '';
    if (!value) {
      return;
    }

    const amount = Number(value);
    if (Number.isFinite(amount)) {
      const column = queryKey === 'REQUESTED_LIMIT' ? 'REQUESTED_LIMIT_AMOUNT' : 'APPROVED_LIMIT_AMOUNT';
      conditions.push({ [column]: amount });
    }
  });

  ['REQUESTED_NAME', 'UPDATED_NAME'].forEach((queryKey) => {
    const value = typeof query[queryKey] === 'string' ? query[queryKey].trim() : '';
    if (value) {
      const modelAlias = queryKey === 'REQUESTED_NAME' ? 'requestedByEmployee' : 'updatedByEmployee';
      conditions.push(
        where(
          fn('CONCAT', col(`${modelAlias}.INITIALS`), '-', col(`${modelAlias}.USERNAME`)),
          { [Op.like]: `%${value}%` },
        ),
      );
    }
  });

  const updatedDate = typeof query.UPDATED_DATE === 'string' ? query.UPDATED_DATE.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(updatedDate)) {
    const start = new Date(`${updatedDate}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    conditions.push({ UPDATED_DATE: { [Op.gte]: start, [Op.lt]: end } });
  }

  const quickFilters = normalizeQuickFilters(query.quickFilter);
  if (quickFilters.length) {
    const quickConditions = [];

    if (quickFilters.includes('rating')) {
      quickConditions.push(nonBlankName('requestedRating'), nonBlankName('approvedRating'));
    }
    if (quickFilters.includes('limit')) {
      quickConditions.push(
        { REQUESTED_LIMIT_AMOUNT: { [Op.ne]: 0 } },
        { APPROVED_LIMIT_AMOUNT: { [Op.ne]: 0 } },
      );
    }
    if (quickFilters.includes('term')) {
      quickConditions.push(nonBlankName('requestedTerm'), nonBlankName('approvedTerm'));
    }

    conditions.push({ [Op.or]: quickConditions });
  }

  return { [Op.and]: conditions };
}

function buildIncludes(models) {
  const { Rating, Term, Status, Employee } = models;

  return [
    { model: Rating, as: 'existingRating', required: false },
    { model: Rating, as: 'requestedRating', required: false },
    { model: Rating, as: 'proposedRating', required: false },
    { model: Rating, as: 'approvedRating', required: false },
    { model: Term, as: 'requestedTerm', required: false },
    { model: Term, as: 'proposedTerm', required: false },
    { model: Term, as: 'approvedTerm', required: false },
    { model: Status, as: 'status', required: false },
    { model: Status, as: 'sapStatus', required: false },
    { model: Employee, as: 'requestedByEmployee', required: false },
    { model: Employee, as: 'updatedByEmployee', required: false },
  ];
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isNonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function employeeName(employee) {
  if (!employee || !isNonBlank(employee.INITIALS) || !isNonBlank(employee.USERNAME)) {
    return '';
  }
  return `${employee.INITIALS}-${employee.USERNAME}`;
}

function salesGroupName(code) {
  const salesGroups = {
    100: '100 - TGEE',
    200: '200 - MG',
    300: '300 - PG',
  };

  return salesGroups[code] || 'OTHERS';
}

function formatUpdatedDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';

  return `${part('day')} ${part('month')} ${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function customerSizeIdForCapital(capitalAmount) {
  if (capitalAmount < MEDIUM_CUSTOMER_CAPITAL_MINIMUM) return SMALL_CUSTOMER_SIZE_ID;
  if (capitalAmount <= LARGE_CUSTOMER_CAPITAL_MINIMUM) return MEDIUM_CUSTOMER_SIZE_ID;
  return LARGE_CUSTOMER_SIZE_ID;
}

function mapRequest(request) {
  const existingRating = request.existingRating?.NAME || '';
  const requestedRating = request.requestedRating?.NAME || '';
  const proposedRating = request.proposedRating?.NAME || '';
  const approvedRating = request.approvedRating?.NAME || '';
  const requestedTerm = request.requestedTerm?.NAME || '';
  const proposedTerm = request.proposedTerm?.NAME || '';
  const approvedTerm = request.approvedTerm?.NAME || '';
  const requestedLimit = toNumber(request.REQUESTED_LIMIT_AMOUNT);
  const proposedLimit = request.PROPOSED_LIMIT_AMOUNT === null || request.PROPOSED_LIMIT_AMOUNT === undefined
    ? null
    : toNumber(request.PROPOSED_LIMIT_AMOUNT);
  const approvedLimit = toNumber(request.APPROVED_LIMIT_AMOUNT);

  return {
    id: request.ID,
    NO: request.NO || '',
    CUSTOMER_NAME_TH: request.CUSTOMER_NAME_TH || '',
    CUSTOMER_NAME_ENG: request.CUSTOMER_NAME_ENG || '',
    CUSTOMER_SALES_GROUP: salesGroupName(request.REQUESTED_SALES_GROUP),
    CUSTOMER_SALES_GROUP_CODE: request.REQUESTED_SALES_GROUP || '',
    REQUESTED_SALES_GROUP: request.REQUESTED_SALES_GROUP || '',
    REQUESTED_CUSTOMER_TYPE: request.REQUESTED_CUSTOMER_TYPE || '',
    REQUESTED_SELLING_TYPE: request.REQUESTED_SELLING_TYPE || '',
    REQUESTED_EXPECTED_SALES_AMOUNT: request.REQUESTED_EXPECTED_SALES_AMOUNT === null || request.REQUESTED_EXPECTED_SALES_AMOUNT === undefined
      ? null : toNumber(request.REQUESTED_EXPECTED_SALES_AMOUNT),
    REQUESTED_DELIVERY_FREQUENCY: request.REQUESTED_DELIVERY_FREQUENCY || '',
    REQUESTED_ADDITIONAL_EXPECTED_AMOUNT: request.REQUESTED_ADDITIONAL_EXPECTED_AMOUNT === null || request.REQUESTED_ADDITIONAL_EXPECTED_AMOUNT === undefined
      ? null : toNumber(request.REQUESTED_ADDITIONAL_EXPECTED_AMOUNT),
    REQUESTED_NOTES: request.REQUESTED_NOTES || '',
    BDS_NOTES: request.BDS_NOTES || '',
    CRM_NO: request.CRM_NO || '',
    SUBJECT: request.DESCRIPTION || '',
    PROPOSED_DISPLAYED_NOTES: request.PROPOSED_DISPLAYED_NOTES || '',
    PROPOSED_NOTES: request.PROPOSED_NOTES || '',
    CANCELLED_NOTES: request.CANCELLED_NOTES || '',
    REF_FINANCIAL_STATEMENT_FY: formatDate(request.REF_FINANCIAL_STATEMENT_FY),
    SUBMITTED_BY: request.SUBMITTED_BY === null || request.SUBMITTED_BY === undefined
      ? null : Number(request.SUBMITTED_BY),
    SCORING_PROFITABILITY: request.SCORING_PROFITABILITY?.toString() || '-',
    SCORING_GROWTH: request.SCORING_GROWTH?.toString() || '-',
    SCORING_LIQUIDITY: request.SCORING_LIQUIDITY?.toString() || '-',
    SCORING_LEVERAGE: request.SCORING_LEVERAGE?.toString() || '-',
    IS_SCORING_GOVERMENT: Boolean(request.IS_SCORING_GOVERMENT),
    IS_SCORING_OTHER: Boolean(request.IS_SCORING_OTHER),
    SCORING_NOTES: request.SCORING_NOTES || '',
    IS_SCORING_NA: Boolean(request.IS_SCORING_NA),
    EXISTING_PROFITABILITY: request.EXISTING_PROFITABILITY?.toString() || '-',
    EXISTING_GROWTH: request.EXISTING_GROWTH?.toString() || '-',
    EXISTING_LIQUIDITY: request.EXISTING_LIQUIDITY?.toString() || '-',
    EXISTING_LEVERAGE: request.EXISTING_LEVERAGE?.toString() || '-',
    SCORING_RATING_ID: request.SCORING_RATING_ID || '',
    IS_PAY_IN_ADVANCE: Boolean(request.IS_PAY_IN_ADVANCE),
    IS_PAY_ON_TIME: Boolean(request.IS_PAY_ON_TIME),
    IS_OVERDUE_LT_10_DAYS: Boolean(request.IS_OVERDUE_LT_10_DAYS),
    IS_OVERDUE_GT_10_DAYS: Boolean(request.IS_OVERDUE_GT_10_DAYS),
    IS_OVERDUE_GT_30_DAYS: Boolean(request.IS_OVERDUE_GT_30_DAYS),
    IS_OVERDUE_GT_60_DAYS: Boolean(request.IS_OVERDUE_GT_60_DAYS),
    IS_OVERDUE_GT_90_DAYS: Boolean(request.IS_OVERDUE_GT_90_DAYS),
    IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED: Boolean(request.IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED),
    IS_WITHIN_APPROVED_LIMIT_PROPOSED: Boolean(request.IS_WITHIN_APPROVED_LIMIT_PROPOSED),
    IS_BANK_GUARANTEE_PROPOSED: Boolean(request.IS_BANK_GUARANTEE_PROPOSED),
    PROPOSED_BANK_GUARANTEE_AMOUNT: toNumber(request.PROPOSED_BANK_GUARANTEE_AMOUNT),
    IS_CASH_DEPOSIT_PROPOSED: Boolean(request.IS_CASH_DEPOSIT_PROPOSED),
    PROPOSED_CASH_DEPOSIT_AMOUNT: toNumber(request.PROPOSED_CASH_DEPOSIT_AMOUNT),
    SOLD_TO: request.SOLD_TO || '',
    CUSTOMER_TAX_NO: request.CUSTOMER_TAX_NO || '',
    SEARCH_TERM: request.SEARCH_TERM || '',
    EXISTING_RATING_ID: request.EXISTING_RATING_ID || '',
    EXISTING_RATING: existingRating,
    REQUESTED_RATING_ID: request.REQUESTED_RATING_ID || '',
    REQUESTED_LIMIT_AMOUNT: request.REQUESTED_LIMIT_AMOUNT === null || request.REQUESTED_LIMIT_AMOUNT === undefined
      ? null : toNumber(request.REQUESTED_LIMIT_AMOUNT),
    REQUESTED_RATING: requestedRating,
    PROPOSED_RATING_ID: request.PROPOSED_RATING_ID || '',
    PROPOSED_RATING: proposedRating,
    REQUESTED_LIMIT: requestedLimit,
    PROPOSED_LIMIT: proposedLimit,
    REQUESTED_TERM: requestedTerm,
    REQUESTED_TERM_ID: request.REQUESTED_TERM_ID || '',
    PROPOSED_TERM_ID: request.PROPOSED_TERM_ID || '',
    PROPOSED_TERM: proposedTerm,
    PROPOSED_VALID_FROM: request.PROPOSED_VALID_FROM || null,
    PROPOSED_VALID_TO: request.PROPOSED_VALID_TO || null,
    APPROVED_RATING: approvedRating,
    APPROVED_LIMIT: approvedLimit,
    APPROVED_TERM: approvedTerm,
    APPROVED_VALID_FROM: formatDate(request.APPROVED_VALID_FROM),
    APPROVED_VALID_TO: formatDate(request.APPROVED_VALID_TO),
    APPROVED_NOTES: request.APPROVED_NOTES || '',
    IS_PERMANENT_APPROVED: Boolean(request.IS_PERMANENT_APPROVED),
    IS_TEMPORARY_APPROVED: Boolean(request.IS_TEMPORARY_APPROVED),
    STATUS_ID: request.STATUS_ID || '',
    STATUS: request.status?.NAME || '',
    STATUS_SAP_ID: request.STATUS_SAP_ID || '',
    SAP_STATUS: String(request.STATUS_SAP_ID || '').toLowerCase() === WAITING_APPROVAL_STATUS_ID
      ? '-' : request.sapStatus?.NAME || '',
    REQUESTED_NAME: employeeName(request.requestedByEmployee),
    REQUESTED_BY: request.REQUESTED_BY === null || request.REQUESTED_BY === undefined
      ? null : Number(request.REQUESTED_BY),
    UPDATED_NAME: employeeName(request.updatedByEmployee),
    CREATED_DATE: formatUpdatedDate(request.CREATED_DATE),
    UPDATED_DATE: formatUpdatedDate(request.UPDATED_DATE),
    CUSTOMER_PHONE: request.CUSTOMER_PHONE || '',
    CUSTOMER_FAX: request.CUSTOMER_FAX || '',
    CUSTOMER_REGISTERED_DATE: formatDate(request.CUSTOMER_REGISTERED_DATE),
    CUSTOMER_REGISTERED_CAPITAL_AMOUNT: request.CUSTOMER_REGISTERED_CAPITAL_AMOUNT?.toString() || '0',
    CUSTOMER_SIZE_ID: customerSizeIdForCapital(BigInt(request.CUSTOMER_REGISTERED_CAPITAL_AMOUNT?.toString() || '0')),
    CUSTOMER_BUSINESS_TYPE_INTER: request.CUSTOMER_BUSINESS_TYPE_INTER || '',
    CUSTOMER_CUSTOMER_TYPE_EXTER: request.CUSTOMER_CUSTOMER_TYPE_EXTER || '',
    CUSTOMER_SHAREHOLDERS: request.CUSTOMER_SHAREHOLDERS || '',
    CUSTOMER_DIRECTORS: request.CUSTOMER_DIRECTORS || '',
    CUSTOMER_ADDRESS: request.CUSTOMER_ADDRESS || '',
    IS_RATING_REQUESTED: isNonBlank(requestedRating) ? 1 : 0,
    IS_LIMIT_REQUESTED: Boolean(request.IS_LIMIT_REQUESTED),
    IS_TERM_REQUESTED: Boolean(request.IS_TERM_REQUESTED),
    IS_LIMIT_PROPOSED: Boolean(request.IS_LIMIT_PROPOSED),
    IS_TERM_PROPOSED: Boolean(request.IS_TERM_PROPOSED),
    IS_PERMANENT_PROPOSED: Boolean(request.IS_PERMANENT_PROPOSED),
    IS_TEMPORARY_PROPOSED: Boolean(request.IS_TEMPORARY_PROPOSED),
    IS_RATING_APPROVED: isNonBlank(approvedRating) ? 1 : 0,
    IS_LIMIT_APPROVED: Boolean(request.IS_LIMIT_APPROVED),
    IS_TERM_APPROVED: Boolean(request.IS_TERM_APPROVED),
  };
}

function formatCompanyCode(company) {
  const companyCode = company?.COMP_CODE?.trim() || '';
  const description = company?.DESCRIPTION?.trim() || '';

  if (!companyCode) return description;
  if (!description) return companyCode;
  return `${companyCode} - ${description}`;
}

async function getCompanyCode(soldTo) {
  if (!isNonBlank(soldTo)) return '';

  const companies = await getDatabase().query(
    `SELECT DISTINCT
      TB3.COMP_CODE,
      TB3.DESCRIPTION
    FROM [MDCENTER_PRD].[dbo].[CUSTOMER] AS TB2
    LEFT JOIN [MDCENTER_PRD].[dbo].[COMPANYMASTER] AS TB3
      ON TB2.SALES_ORG = TB3.COMP_CODE
    WHERE :soldTo COLLATE Thai_CI_AI = TB2.CUST_NO`,
    {
      replacements: { soldTo: soldTo.trim() },
      type: QueryTypes.SELECT,
    },
  );

  return formatCompanyCode(companies[0]);
}

function buildOrder(sort, dir) {
  if (!sort) {
    return [['CREATED_DATE', 'DESC']];
  }

  const column = SORT_FIELDS[sort];
  if (!column) {
    const error = new Error(`Unsupported sort field: ${sort}`);
    error.statusCode = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }

  return [[column, dir === 'desc' ? 'DESC' : 'ASC']];
}

async function listRequests(query) {
  const models = getModels();
  const page = normalizePage(query.page, 1);
  const pageSize = Math.min(normalizePage(query.pageSize, 25), 100);
  const result = await models.Request.findAndCountAll({
    where: buildWhere(query),
    include: buildIncludes(models),
    order: buildOrder(query.sort, query.dir),
    offset: (page - 1) * pageSize,
    limit: pageSize,
    distinct: true,
  });

  return {
    items: result.rows.map(mapRequest),
    pagination: {
      page,
      pageSize,
      totalItems: result.count,
      totalPages: Math.ceil(result.count / pageSize),
    },
  };
}

async function getRequestById(id) {
  const models = getModels();
  const request = await models.Request.findOne({
    where: { ID: id, ENABLED: true },
    include: buildIncludes(models),
  });

  if (!request) return null;

  const response = mapRequest(request);
  response.PREVIOUS_REF_FINANCIAL_STATEMENT_FY = await findPreviousFinancialStatementYear(models.Request, request);
  response.COMPANY_CODE = await getCompanyCode(response.SOLD_TO);
  return response;
}

async function findPreviousFinancialStatementYear(Request, currentRequest) {
  const taxId = typeof currentRequest.CUSTOMER_TAX_NO === 'string'
    ? currentRequest.CUSTOMER_TAX_NO.trim()
    : '';
  if (!/^\d{13}$/.test(taxId)) return null;

  const previousRequest = await Request.findOne({
    attributes: ['REF_FINANCIAL_STATEMENT_FY'],
    where: {
      CUSTOMER_TAX_NO: taxId,
      ENABLED: true,
      ID: { [Op.ne]: currentRequest.ID },
    },
    order: [['CREATED_DATE', 'DESC']],
    raw: true,
  });

  const value = previousRequest?.REF_FINANCIAL_STATEMENT_FY;
  if (!value) return null;
  const year = new Date(value).getUTCFullYear();
  return Number.isInteger(year) && year > 0 ? String(year) : null;
}

async function listApprovalHistory(requestId, { includeDisabledApprovals = false, transaction } = {}) {
  const approvalHistoryOrder = includeDisabledApprovals
    ? 'UPDATED_AT DESC, SORTING ASC'
    : 'SORTING ASC';
  return getDatabase().query(
    `SELECT *
    FROM (
      SELECT
        CAST(TB1.ID AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS ID,
        ISNULL(TB1.REQUESTED_NOTES, '-') COLLATE DATABASE_DEFAULT AS COMMENT,
        TB1.REQUESTED_LIMIT_AMOUNT AS CREDIT_LIMIT,
        ISNULL(TB4.NAME, '') COLLATE DATABASE_DEFAULT AS CREDIT_TERM,
        ISNULL(TB5.NAME, '') COLLATE DATABASE_DEFAULT AS CREDIT_RATING,
        'Requester' COLLATE DATABASE_DEFAULT AS APPROVER_TYPE_NAME,
        'Requested' COLLATE DATABASE_DEFAULT AS APPROVAL_TYPE_NAME,
        CAST(NULL AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS APPROVAL_TYPE_ID,
        CAST(0 AS BIT) AS ALLOW_BACKWARD,
        CAST(1 AS BIT) AS CURRENT_CYCLE,
        'No' COLLATE DATABASE_DEFAULT AS INCLUDED_CLEAR_OUTSTANDING_BALANCE,
        'No' COLLATE DATABASE_DEFAULT AS INCLUDED_WITHIN_APPROVED_LIMIT,
        'No' COLLATE DATABASE_DEFAULT AS INCLUDED_BANK_GUARANTEE,
        '0.00' AS BANK_GUARANTEE_AMOUNT,
        'No' COLLATE DATABASE_DEFAULT AS INCLUDED_CASH_DEPOSIT,
        '0.00' AS CASH_DEPOSIT_AMOUNT,
        CAST(TB2.EMP_CODE AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS APPROVER_ID,
        CONCAT(TB2.INITIALS, '-', TB2.USERNAME) COLLATE DATABASE_DEFAULT AS APPROVER_NAME,
        TB2.CURRENT_EMAIL COLLATE DATABASE_DEFAULT AS APPROVER_EMAIL,
        FORMAT(TB1.CREATED_DATE, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS LAST_UPDATE_DATE,
        TB1.CREATED_DATE AS UPDATED_AT,
        CONCAT(TB3.INITIALS, '-', TB3.USERNAME) COLLATE DATABASE_DEFAULT AS LAST_UPDATE_BY,
        (CASE WHEN TB1.IS_PERMANENT_REQUESTED = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS PERMANENT,
        (CASE WHEN TB1.IS_TEMPORARY_REQUESTED = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS TEMPORARY,
        FORMAT(TB1.REQUESTED_VALID_FROM, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS VALID_FROM,
        FORMAT(TB1.REQUESTED_VALID_TO, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS VALID_TO,
        CAST(NULL AS VARCHAR(255)) COLLATE DATABASE_DEFAULT AS PARALLEL_KEYS,
        1 AS APPROVAL_STEP,
        1 AS SORTING
      FROM REQUESTS AS TB1
      LEFT JOIN S_EMPLOYEE1 AS TB2 ON TB2.EMP_CODE = TB1.REQUESTED_BY
      LEFT JOIN S_EMPLOYEE1 AS TB3 ON TB3.EMP_CODE = TB1.CREATED_BY
      LEFT JOIN TERMS AS TB4 ON TB4.ID = TB1.REQUESTED_TERM_ID
      LEFT JOIN RATINGS AS TB5 ON TB5.ID = TB1.REQUESTED_RATING_ID
      WHERE TB1.ENABLED = '1' AND TB1.ID = :requestId

      UNION ALL

      SELECT
        CAST(TB1.ID AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS ID,
        ISNULL(TB1.PROPOSED_NOTES, '-') COLLATE DATABASE_DEFAULT AS COMMENT,
        TB1.PROPOSED_LIMIT_AMOUNT AS CREDIT_LIMIT,
        ISNULL(TB4.NAME, '') COLLATE DATABASE_DEFAULT AS CREDIT_TERM,
        ISNULL(TB5.NAME, '') COLLATE DATABASE_DEFAULT AS CREDIT_RATING,
        (SELECT TOP(1) NAME FROM APPROVER_TYPES WHERE ID = 'fca8c4fa-51e8-4c7d-95ac-274d62ba5d7f') COLLATE DATABASE_DEFAULT AS APPROVER_TYPE_NAME,
        'Suggested' COLLATE DATABASE_DEFAULT AS APPROVAL_TYPE_NAME,
        CAST(NULL AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS APPROVAL_TYPE_ID,
        CAST(0 AS BIT) AS ALLOW_BACKWARD,
        CAST(1 AS BIT) AS CURRENT_CYCLE,
        (CASE WHEN TB1.IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS INCLUDED_CLEAR_OUTSTANDING_BALANCE,
        (CASE WHEN TB1.IS_WITHIN_APPROVED_LIMIT_PROPOSED = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS INCLUDED_WITHIN_APPROVED_LIMIT,
        (CASE WHEN TB1.IS_BANK_GUARANTEE_PROPOSED = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS INCLUDED_BANK_GUARANTEE,
        TB1.PROPOSED_BANK_GUARANTEE_AMOUNT AS BANK_GUARANTEE_AMOUNT,
        (CASE WHEN TB1.IS_CASH_DEPOSIT_PROPOSED = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS INCLUDED_CASH_DEPOSIT,
        TB1.PROPOSED_CASH_DEPOSIT_AMOUNT AS CASH_DEPOSIT_AMOUNT,
        CAST(TB2.EMP_CODE AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS APPROVER_ID,
        CONCAT(TB2.INITIALS, '-', TB2.USERNAME) COLLATE DATABASE_DEFAULT AS APPROVER_NAME,
        TB2.CURRENT_EMAIL COLLATE DATABASE_DEFAULT AS APPROVER_EMAIL,
        FORMAT(TB1.SUBMITTED_DATE, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS LAST_UPDATE_DATE,
        TB1.SUBMITTED_DATE AS UPDATED_AT,
        CONCAT(TB3.INITIALS, '-', TB3.USERNAME) COLLATE DATABASE_DEFAULT AS LAST_UPDATE_BY,
        (CASE WHEN TB1.IS_PERMANENT_PROPOSED = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS PERMANENT,
        (CASE WHEN TB1.IS_TEMPORARY_PROPOSED = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS TEMPORARY,
        FORMAT(TB1.PROPOSED_VALID_FROM, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS VALID_FROM,
        FORMAT(TB1.PROPOSED_VALID_TO, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS VALID_TO,
        CAST(NULL AS VARCHAR(255)) COLLATE DATABASE_DEFAULT AS PARALLEL_KEYS,
        2 AS APPROVAL_STEP,
        2 AS SORTING
      FROM REQUESTS AS TB1
      LEFT JOIN S_EMPLOYEE1 AS TB2 ON TB2.EMP_CODE = TB1.SUBMITTED_BY
      LEFT JOIN S_EMPLOYEE1 AS TB3 ON TB3.EMP_CODE = TB1.SUBMITTED_BY
      LEFT JOIN TERMS AS TB4 ON TB4.ID = TB1.PROPOSED_TERM_ID
      LEFT JOIN RATINGS AS TB5 ON TB5.ID = TB1.PROPOSED_RATING_ID
      WHERE TB1.ENABLED = '1' AND TB1.ID = :requestId

      UNION ALL

      SELECT
        CAST(TB1.ID AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS ID,
        ISNULL(TB1.DESCRIPTION, '-') COLLATE DATABASE_DEFAULT AS COMMENT,
        TB1.LIMIT_AMOUNT AS CREDIT_LIMIT,
        ISNULL(TB6.NAME, '') COLLATE DATABASE_DEFAULT AS CREDIT_TERM,
        ISNULL(TB7.NAME, '') COLLATE DATABASE_DEFAULT AS CREDIT_RATING,
        ISNULL(TB2.NAME, '') COLLATE DATABASE_DEFAULT AS APPROVER_TYPE_NAME,
        ISNULL(TB3.NAME, '') COLLATE DATABASE_DEFAULT AS APPROVAL_TYPE_NAME,
        CAST(TB1.APPROVAL_TYPE_ID AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS APPROVAL_TYPE_ID,
        CAST(ISNULL(TB2.ALLOW_BACKWARD, 0) AS BIT) AS ALLOW_BACKWARD,
        CAST(CASE WHEN TB8.SUBMITTED_DATE IS NULL OR TB1.CREATED_DATE >= TB8.SUBMITTED_DATE THEN 1 ELSE 0 END AS BIT) AS CURRENT_CYCLE,
        (CASE WHEN TB1.IS_CLEAR_OUTSTANDING_BALANCE = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS INCLUDED_CLEAR_OUTSTANDING_BALANCE,
        (CASE WHEN TB1.IS_WITHIN_APPROVED_LIMIT = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS INCLUDED_WITHIN_APPROVED_LIMIT,
        (CASE WHEN TB1.IS_BANK_GUARANTEE = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS INCLUDED_BANK_GUARANTEE,
        TB1.BANK_GUARANTEE_AMOUNT AS BANK_GUARANTEE_AMOUNT,
        (CASE WHEN TB1.IS_CASH_DEPOSIT = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS INCLUDED_CASH_DEPOSIT,
        TB1.CASH_DEPOSIT_AMOUNT AS CASH_DEPOSIT_AMOUNT,
        CAST(TB4.EMP_CODE AS VARCHAR(36)) COLLATE DATABASE_DEFAULT AS APPROVER_ID,
        CONCAT(TB4.INITIALS, '-', TB4.USERNAME) COLLATE DATABASE_DEFAULT AS APPROVER_NAME,
        TB4.CURRENT_EMAIL COLLATE DATABASE_DEFAULT AS APPROVER_EMAIL,
        FORMAT(TB1.UPDATED_DATE, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS LAST_UPDATE_DATE,
        TB1.UPDATED_DATE AS UPDATED_AT,
        CONCAT(TB5.INITIALS, '-', TB5.USERNAME) COLLATE DATABASE_DEFAULT AS LAST_UPDATE_BY,
        (CASE WHEN TB1.IS_PERMANENT = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS PERMANENT,
        (CASE WHEN TB1.IS_TEMPORARY = '1' THEN 'Yes' ELSE 'No' END) COLLATE DATABASE_DEFAULT AS TEMPORARY,
        FORMAT(TB1.VALID_FROM, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS VALID_FROM,
        FORMAT(TB1.VALID_TO, 'dd MMM yyyy, hh:mm tt') COLLATE DATABASE_DEFAULT AS VALID_TO,
        CAST(TB2.PARALLEL_KEYS AS VARCHAR(255)) COLLATE DATABASE_DEFAULT AS PARALLEL_KEYS,
        TB1.APPROVAL_STEP AS APPROVAL_STEP,
        TB1.SORTING + 2 AS SORTING
      FROM APPROVALS AS TB1
      LEFT JOIN APPROVER_TYPES AS TB2 ON TB1.APPROVER_TYPE_ID = TB2.ID
      LEFT JOIN APPROVAL_TYPES AS TB3 ON TB3.ID = TB1.APPROVAL_TYPE_ID
      LEFT JOIN REQUESTS AS TB8
        ON CONVERT(VARCHAR(36), TB8.ID) COLLATE DATABASE_DEFAULT
         = CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT
      LEFT JOIN S_EMPLOYEE1 AS TB4 ON TB4.EMP_CODE = TB1.APPROVER_ID
      LEFT JOIN S_EMPLOYEE1 AS TB5 ON TB5.EMP_CODE = TB1.UPDATED_BY
      LEFT JOIN TERMS AS TB6 ON TB6.ID = TB1.TERM_ID
      LEFT JOIN RATINGS AS TB7 ON TB7.ID = TB1.RATING_ID
      WHERE (TB1.ENABLED = '1' OR :includeDisabledApprovals = 1) AND TB1.REQUEST_ID = :requestId
    ) AS APPROVAL_HISTORY
    ORDER BY ${approvalHistoryOrder}`,
    {
      replacements: { requestId, includeDisabledApprovals: includeDisabledApprovals ? 1 : 0 },
      type: QueryTypes.SELECT,
      ...(transaction ? { transaction } : {}),
    },
  );
}

async function getApprovalSubmitOptions(requestId) {
  const database = getDatabase();
  const [request] = await database.query(
    `SELECT PROPOSED_LIMIT_AMOUNT
     FROM REQUESTS
     WHERE ID = :requestId AND ENABLED = '1'`,
    { replacements: { requestId }, type: QueryTypes.SELECT },
  );
  if (!request) return null;

  const [approvers, bdsReviewApprovers, approverTypes, defaultApprovers] = await Promise.all([
    database.query(
      `SELECT DISTINCT TB1.APPROVER_ID AS ID,
              CONCAT(TB3.INITIALS, '-', TB3.USERNAME) AS NAME,
              TB1.APPROVER_TYPE_ID,
              TB1.[PRIMARY] AS [PRIMARY]
       FROM APPROVERS AS TB1
       INNER JOIN APPROVER_TYPES AS TB2
         ON CONVERT(VARCHAR(36), TB2.ID) COLLATE DATABASE_DEFAULT
          = CONVERT(VARCHAR(36), TB1.APPROVER_TYPE_ID) COLLATE DATABASE_DEFAULT
       INNER JOIN S_EMPLOYEE1 AS TB3
         ON TB3.EMP_CODE = TB1.APPROVER_ID
       WHERE TB1.ENABLED = '1'
         AND TB2.ENABLED = '1'
         AND TB3.WORK_STATUS = '3'
         AND TB3.CURRENT_EMAIL IS NOT NULL
       ORDER BY TB1.APPROVER_TYPE_ID, NAME`,
      { type: QueryTypes.SELECT },
    ),
    database.query(
      `SELECT EMP_CODE AS ID, CONCAT(INITIALS, '-', USERNAME) AS NAME
       FROM S_EMPLOYEE1
       WHERE WORK_STATUS = '3' AND CURRENT_EMAIL IS NOT NULL
       ORDER BY INITIALS ASC`,
      { type: QueryTypes.SELECT },
    ),
    database.query(
      `SELECT ID, NAME, PARALLEL_KEYS, MIN_AMOUNT, MAX_AMOUNT, ALLOW_BACKWARD
       FROM APPROVER_TYPES
       WHERE ENABLED = '1'
       ORDER BY SORTING ASC`,
      { type: QueryTypes.SELECT },
    ),
    database.query(
      `SELECT TB1.ID, TB1.NAME, TB1.DESCRIPTION, TB1.APPROVER_ID, TB1.APPROVER_TYPE_ID,
              TB1.[PRIMARY] AS [PRIMARY]
       FROM APPROVERS AS TB1
       LEFT JOIN APPROVER_TYPES AS TB2 ON TB1.APPROVER_TYPE_ID = TB2.ID
       WHERE TB1.ENABLED = '1'
         AND TB2.ENABLED = '1'
       ORDER BY TB2.SORTING ASC`,
      { type: QueryTypes.SELECT },
    ),
  ]);

  return {
    proposedLimitAmount: request.PROPOSED_LIMIT_AMOUNT,
    approvers,
    bdsReviewApprovers,
    approverTypes,
    defaultApprovers,
  };
}

function normalizeSubmitSteps(steps) {
  if (!Array.isArray(steps)) throw validationError('Approval steps must be an array.');
  const normalized = steps.map((step, index) => {
    if (!step || typeof step !== 'object' || typeof step.approverTypeId !== 'string' || !step.approverTypeId.trim()) {
      throw validationError(`Approval step ${index + 1} requires an approver type.`);
    }
    if (typeof step.approverId !== 'string' && typeof step.approverId !== 'number') {
      throw validationError(`Approval step ${index + 1} requires an approver.`);
    }
    const approverId = String(step.approverId).trim();
    if (!approverId) throw validationError(`Approval step ${index + 1} requires an approver.`);
    if (!Number.isInteger(step.approvalStep) || step.approvalStep < 1) {
      throw validationError(`Approval step ${index + 1} requires a positive approvalStep.`);
    }
    if (!Number.isInteger(step.sorting) || step.sorting < 1) {
      throw validationError(`Approval step ${index + 1} requires a positive sorting value.`);
    }
    return {
      approverTypeId: step.approverTypeId.trim(),
      approverId,
      approvalStep: step.approvalStep,
      sorting: step.sorting,
    };
  });

  const sorting = normalized.map((step) => step.sorting).sort((left, right) => left - right);
  if (sorting.some((value, index) => value !== index + 1)) {
    throw validationError('Approval sorting values must be unique and contiguous from 1.');
  }
  const approvalSteps = [...new Set(normalized.map((step) => step.approvalStep))].sort((left, right) => left - right);
  if (approvalSteps.some((value, index) => value !== index + 1)) {
    throw validationError('Approval step values must be contiguous from 1.');
  }
  return normalized;
}

async function submitRequest(id, command, updatedBy) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw validationError('A submit command is required.');
  }
  const customerUpdate = normalizeRequestCustomerInfo(command.customerInfo ?? {});
  const creditUpdate = normalizeRequestCreditSuggestion(command.creditSuggestion ?? {});
  const scoringUpdate = normalizeRequestScoringAndPayment(command.scoringAndPayment ?? {});
  const requestedUpdate = normalizeRequestRequestedDetails(command.requestedDetails ?? {});
  const normalizedSteps = normalizeSubmitSteps(command.steps ?? []);
  const approvalValues = { ...creditUpdate };
  const hasApprovalSteps = normalizedSteps.length > 0;
  const requiresApproval = hasApprovalSteps;
  const submittedByValue = command.bdsReviewApproverId === undefined
    ? String(updatedBy)
    : String(command.bdsReviewApproverId ?? '').trim();
  if (!/^\d+$/.test(submittedByValue)) throw validationError('BDS Review approver is required.');
  const submittedBy = Number(submittedByValue);
  const database = getDatabase();
  const transaction = await database.transaction();
  try {
    const { Request, Rating, Size, Term } = getModels();
    const request = await Request.findOne({
      where: { ID: id, ENABLED: true },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) throw notFoundError(`Request ${id} was not found.`);

    if (request.STATUS_ID !== DRAFT_STATUS_ID) {
      throw conflictError('Only Draft requests can be submitted.');
    }

    const referenceChecks = [
      Size.findOne({ where: { ID: customerUpdate.CUSTOMER_SIZE_ID, ENABLED: '1' }, transaction }),
      creditUpdate.PROPOSED_TERM_ID
        ? Term.findByPk(creditUpdate.PROPOSED_TERM_ID, { transaction }) : Promise.resolve(true),
      creditUpdate.PROPOSED_RATING_ID
        ? Rating.findOne({ where: { ID: creditUpdate.PROPOSED_RATING_ID, ENABLED: '1' }, transaction }) : Promise.resolve(true),
      scoringUpdate.SCORING_RATING_ID
        ? Rating.findOne({ where: { ID: scoringUpdate.SCORING_RATING_ID, ENABLED: '1' }, transaction }) : Promise.resolve(true),
      requestedUpdate.REQUESTED_TERM_ID
        ? Term.findByPk(requestedUpdate.REQUESTED_TERM_ID, { transaction }) : Promise.resolve(true),
      requestedUpdate.REQUESTED_RATING_ID
        ? Rating.findOne({ where: { ID: requestedUpdate.REQUESTED_RATING_ID, ENABLED: '1' }, transaction }) : Promise.resolve(true),
    ];
    const [size, proposedTerm, proposedRating, scoringRating, requestedTerm, requestedRating] = await Promise.all(referenceChecks);
    if (!size) throw validationError('CUSTOMER_SIZE_ID must reference an enabled size.');
    if (!proposedTerm) throw validationError('PROPOSED_TERM_ID must reference a valid term.');
    if (!proposedRating) throw validationError('PROPOSED_RATING_ID must reference an enabled rating.');
    if (!scoringRating) throw validationError('SCORING_RATING_ID must reference an enabled rating.');
    if (!requestedTerm) throw validationError('REQUESTED_TERM_ID must reference a valid term.');
    if (!requestedRating) throw validationError('REQUESTED_RATING_ID must reference an enabled rating.');

    if (typeof customerUpdate.CUSTOMER_REGISTERED_DATE === 'string') {
      customerUpdate.CUSTOMER_REGISTERED_DATE = databaseDateFromYmd(
        Request.sequelize,
        customerUpdate.CUSTOMER_REGISTERED_DATE,
      );
    }
    ['PROPOSED_VALID_FROM', 'PROPOSED_VALID_TO'].forEach((field) => {
      if (typeof creditUpdate[field] === 'string') {
        creditUpdate[field] = databaseDateFromYmd(Request.sequelize, creditUpdate[field]);
      }
    });
    if (typeof scoringUpdate.REF_FINANCIAL_STATEMENT_FY === 'string') {
      scoringUpdate.REF_FINANCIAL_STATEMENT_FY = databaseDateFromYmd(
        Request.sequelize,
        scoringUpdate.REF_FINANCIAL_STATEMENT_FY,
      );
    }

    const [approverTypes, approvers, pendingRows] = requiresApproval ? await Promise.all([
      database.query(
        'SELECT ID, MIN_AMOUNT, MAX_AMOUNT FROM APPROVER_TYPES WHERE ENABLED = \'1\'',
        { type: QueryTypes.SELECT, transaction },
      ),
      database.query(
        `SELECT DISTINCT TB1.APPROVER_ID AS EMP_CODE, TB1.APPROVER_TYPE_ID
         FROM APPROVERS AS TB1
         INNER JOIN APPROVER_TYPES AS TB2
           ON CONVERT(VARCHAR(36), TB2.ID) COLLATE DATABASE_DEFAULT
            = CONVERT(VARCHAR(36), TB1.APPROVER_TYPE_ID) COLLATE DATABASE_DEFAULT
         INNER JOIN S_EMPLOYEE1 AS TB3
           ON TB3.EMP_CODE = TB1.APPROVER_ID
         WHERE TB1.ENABLED = '1'
           AND TB2.ENABLED = '1'
           AND TB3.WORK_STATUS = '3'
           AND TB3.CURRENT_EMAIL IS NOT NULL`,
        { type: QueryTypes.SELECT, transaction },
      ),
      database.query(
        `SELECT TB1.ID FROM APPROVALS AS TB1
         INNER JOIN APPROVAL_TYPES AS TB2
           ON CONVERT(VARCHAR(36), TB2.ID) COLLATE DATABASE_DEFAULT
            = CONVERT(VARCHAR(36), TB1.APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
         INNER JOIN REQUESTS AS TB3
           ON CONVERT(VARCHAR(36), TB3.ID) COLLATE DATABASE_DEFAULT
            = CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT
         WHERE CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
           AND TB1.ENABLED = '1'
           AND TB2.NAME COLLATE DATABASE_DEFAULT = 'Pending' COLLATE DATABASE_DEFAULT
           AND CONVERT(VARCHAR(36), TB3.STATUS_ID) COLLATE DATABASE_DEFAULT
             <> CONVERT(VARCHAR(36), :draftStatusId) COLLATE DATABASE_DEFAULT`,
        { replacements: { id, draftStatusId: DRAFT_STATUS_ID }, type: QueryTypes.SELECT, transaction },
      ),
    ]) : [[], [], []];
    if (pendingRows.length) throw conflictError('This request already has pending approvals.');

    const typeIds = new Set(approverTypes.map((type) => String(type.ID)));
    const approverAssignments = new Set(approvers.map((approver) =>
      `${String(approver.APPROVER_TYPE_ID).toLowerCase()}:${String(approver.EMP_CODE)}`,
    ));
    normalizedSteps.forEach((step, index) => {
      if (!typeIds.has(step.approverTypeId)) throw validationError(`Approval step ${index + 1} uses an invalid approver type.`);
      if (!approverAssignments.has(`${step.approverTypeId.toLowerCase()}:${step.approverId}`)) {
        throw validationError(`Approval step ${index + 1} uses an approver not configured for the selected approver type.`);
      }
    });

    const requestUpdate = {
      ...customerUpdate,
      ...creditUpdate,
      ...scoringUpdate,
      ...requestedUpdate,
      STATUS_ID: requiresApproval ? WAITING_APPROVAL_STATUS_ID : COMPLETED_STATUS_ID,
      SUBMITTED_DATE: Request.sequelize.fn('GETDATE'),
      SUBMITTED_BY: submittedBy,
      UPDATED_BY: updatedBy,
      UPDATED_DATE: Request.sequelize.fn('GETDATE'),
    };
    if (!hasApprovalSteps) {
      Object.assign(requestUpdate, {
        APPROVED_LIMIT_AMOUNT: creditUpdate.PROPOSED_LIMIT_AMOUNT,
        APPROVED_TERM_ID: creditUpdate.PROPOSED_TERM_ID,
        IS_LIMIT_APPROVED: creditUpdate.IS_LIMIT_PROPOSED,
        IS_TERM_APPROVED: creditUpdate.IS_TERM_PROPOSED,
        APPROVED_RATING_ID: creditUpdate.PROPOSED_RATING_ID,
        APPROVED_VALID_FROM: creditUpdate.PROPOSED_VALID_FROM,
        APPROVED_VALID_TO: creditUpdate.PROPOSED_VALID_TO,
        APPROVED_NOTES: creditUpdate.PROPOSED_NOTES,
        IS_PERMANENT_APPROVED: creditUpdate.IS_PERMANENT_PROPOSED,
        IS_TEMPORARY_APPROVED: creditUpdate.IS_TEMPORARY_PROPOSED,
      });
    }
    await request.update(requestUpdate, { transaction });
    await syncCustomerFromRequest(request, updatedBy, transaction, 'all-requests.details.submit', id);

    for (const step of normalizedSteps) {
      await database.query(
        `INSERT INTO APPROVALS (
          ID, REQUEST_ID, APPROVER_TYPE_ID, APPROVAL_TYPE_ID, APPROVER_ID, DESCRIPTION,
          LIMIT_AMOUNT, TERM_ID, RATING_ID, IS_PERMANENT, IS_TEMPORARY, VALID_FROM, VALID_TO,
          IS_CLEAR_OUTSTANDING_BALANCE, IS_WITHIN_APPROVED_LIMIT, IS_BANK_GUARANTEE,
          BANK_GUARANTEE_AMOUNT, IS_CASH_DEPOSIT, CASH_DEPOSIT_AMOUNT, APPROVAL_STEP, SORTING,
          CREATED_BY, CREATED_DATE, UPDATED_BY, UPDATED_DATE, ENABLED
        ) VALUES (
          :approvalId, :requestId, :approverTypeId, :approvalTypeId, :approverId, :description,
          :limitAmount, :termId, :ratingId, :isPermanent, :isTemporary, :validFrom, :validTo,
          :clearOutstanding, :withinLimit, :bankGuarantee, :bankGuaranteeAmount,
          :cashDeposit, :cashDepositAmount, :approvalStep, :sorting,
          :updatedBy, GETDATE(), :updatedBy, GETDATE(), '1'
        )`,
        {
          replacements: {
            approvalId: randomUUID(), requestId: id, approverTypeId: step.approverTypeId,
            approvalTypeId: PENDING_APPROVAL_TYPE_ID, approverId: step.approverId, description: '',
            limitAmount: approvalValues.IS_LIMIT_PROPOSED ? approvalValues.PROPOSED_LIMIT_AMOUNT : null,
            termId: approvalValues.IS_TERM_PROPOSED ? approvalValues.PROPOSED_TERM_ID : null,
            ratingId: approvalValues.PROPOSED_RATING_ID, isPermanent: approvalValues.IS_PERMANENT_PROPOSED,
            isTemporary: approvalValues.IS_TEMPORARY_PROPOSED, validFrom: approvalValues.PROPOSED_VALID_FROM,
            validTo: approvalValues.PROPOSED_VALID_TO,
            clearOutstanding: approvalValues.IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED,
            withinLimit: approvalValues.IS_WITHIN_APPROVED_LIMIT_PROPOSED,
            bankGuarantee: approvalValues.IS_BANK_GUARANTEE_PROPOSED,
            bankGuaranteeAmount: approvalValues.IS_BANK_GUARANTEE_PROPOSED
              ? approvalValues.PROPOSED_BANK_GUARANTEE_AMOUNT : null,
            cashDeposit: approvalValues.IS_CASH_DEPOSIT_PROPOSED,
            cashDepositAmount: approvalValues.IS_CASH_DEPOSIT_PROPOSED
              ? approvalValues.PROPOSED_CASH_DEPOSIT_AMOUNT : null,
            approvalStep: step.approvalStep, sorting: step.sorting, updatedBy,
          },
          type: QueryTypes.INSERT,
          transaction,
        },
      );
    }

    await transaction.commit();
    return getRequestById(id);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function notFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = 'RESOURCE_NOT_FOUND';
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'CONFLICT';
  return error;
}

function databaseDateFromYmd(sequelize, value) {
  const [year, month, day] = value.split('-').map(Number);
  return sequelize.fn('DATEFROMPARTS', year, month, day);
}

function normalizeCloneDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeRequestCustomerInfo(payload) {
  const fields = [
    'CUSTOMER_TAX_NO',
    'CUSTOMER_REGISTERED_DATE',
    'CUSTOMER_REGISTERED_CAPITAL_AMOUNT',
    'CUSTOMER_SIZE_ID',
    'CUSTOMER_BUSINESS_TYPE_INTER',
    'CUSTOMER_CUSTOMER_TYPE_EXTER',
    'CUSTOMER_DIRECTORS',
    'CUSTOMER_SHAREHOLDERS',
  ];
  const update = {};

  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) update[field] = payload[field];
  });

  if (!Object.keys(update).length) throw validationError('No request customer fields were supplied.');
  if (typeof update.CUSTOMER_TAX_NO !== 'string') {
    throw validationError('CUSTOMER_TAX_NO is required.');
  }
  update.CUSTOMER_TAX_NO = update.CUSTOMER_TAX_NO.trim();
  if (update.CUSTOMER_TAX_NO !== '-' && !/^\d{13}$/.test(update.CUSTOMER_TAX_NO)) {
    throw validationError('CUSTOMER_TAX_NO must be - or contain exactly 13 digits.');
  }
  if (Object.prototype.hasOwnProperty.call(update, 'CUSTOMER_REGISTERED_DATE')) {
    if (update.CUSTOMER_REGISTERED_DATE === undefined || update.CUSTOMER_REGISTERED_DATE === null
      || update.CUSTOMER_REGISTERED_DATE === '') {
      update.CUSTOMER_REGISTERED_DATE = null;
    } else if (typeof update.CUSTOMER_REGISTERED_DATE !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(update.CUSTOMER_REGISTERED_DATE)) {
      throw validationError('CUSTOMER_REGISTERED_DATE must use YYYY-MM-DD.');
    } else {
      const parsedDate = new Date(`${update.CUSTOMER_REGISTERED_DATE}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime())
        || parsedDate.toISOString().slice(0, 10) !== update.CUSTOMER_REGISTERED_DATE) {
        throw validationError('CUSTOMER_REGISTERED_DATE must be a valid calendar date.');
      }
    }
  }
  const capitalAmount = update.CUSTOMER_REGISTERED_CAPITAL_AMOUNT;
  const normalizedCapitalAmount = capitalAmount === undefined || capitalAmount === null || capitalAmount === ''
    ? '0'
    : String(capitalAmount);
  if (!/^\d+$/.test(normalizedCapitalAmount)) {
    throw validationError('CUSTOMER_REGISTERED_CAPITAL_AMOUNT must contain whole numbers only.');
  }
  update.CUSTOMER_REGISTERED_CAPITAL_AMOUNT = normalizedCapitalAmount;
  update.CUSTOMER_SIZE_ID = customerSizeIdForCapital(BigInt(normalizedCapitalAmount));

  return update;
}

async function updateRequestCustomerInfo(id, payload, updatedBy) {
  const { Request, Size } = getModels();
  const update = normalizeRequestCustomerInfo(payload);
  const transaction = await getDatabase().transaction();
  try {
    const request = await Request.findOne({
      where: { ID: id, ENABLED: true },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      await transaction.commit();
      return null;
    }
    if (update.CUSTOMER_SIZE_ID) {
      const size = await Size.findOne({
        where: { ID: update.CUSTOMER_SIZE_ID, ENABLED: '1' },
        transaction,
      });
      if (!size) throw validationError('CUSTOMER_SIZE_ID must reference an enabled size.');
    }

    if (typeof update.CUSTOMER_REGISTERED_DATE === 'string') {
      update.CUSTOMER_REGISTERED_DATE = databaseDateFromYmd(Request.sequelize, update.CUSTOMER_REGISTERED_DATE);
    }

    await request.update(
      { ...update, UPDATED_DATE: Request.sequelize.fn('GETDATE'), UPDATED_BY: updatedBy },
      { transaction },
    );
    await syncCustomerFromRequest(request, updatedBy, transaction, 'all-requests.details.customer-save', id);
    await transaction.commit();
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
  return getRequestById(id);
}

async function syncCustomerFromRequest(request, updatedBy, transaction, source, requestId) {
  const taxNo = typeof request.CUSTOMER_TAX_NO === 'string' ? request.CUSTOMER_TAX_NO.trim() : '';
  if (!/^\d{13}$/.test(taxNo)) return;

  const { Customer } = getModels();
  const customerValues = {
    REGISTERED_DATE: request.CUSTOMER_REGISTERED_DATE ?? null,
    REGISTERED_CAPITAL_AMOUNT: request.CUSTOMER_REGISTERED_CAPITAL_AMOUNT ?? null,
    BUSINESS_TYPE_INTER: request.CUSTOMER_BUSINESS_TYPE_INTER ?? null,
    CUSTOMER_TYPE_INTER: request.CUSTOMER_CUSTOMER_TYPE_INTER ?? null,
    BUSINESS_TYPE_EXTER: request.CUSTOMER_BUSINESS_TYPE_EXTER ?? null,
    CUSTOMER_TYPE_EXTER: request.CUSTOMER_CUSTOMER_TYPE_EXTER ?? null,
    SIZE_ID: request.CUSTOMER_SIZE_ID ?? null,
    SHAREHOLDERS: request.CUSTOMER_SHAREHOLDERS ?? null,
    DIRECTORS: request.CUSTOMER_DIRECTORS ?? null,
    UPDATED_DATE: Customer.sequelize.fn('GETDATE'),
    UPDATED_BY: updatedBy,
  };
  const customer = await Customer.findOne({
    where: { ENABLED: '1', TAX_NO: taxNo },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (customer) {
    const before = customer.get ? customer.get({ plain: true }) : { ...customer };
    await customer.update(customerValues, { transaction });
    await customerLogService.recordCustomerMutation({
      customerId: customer.ID,
      taxNo,
      action: 'update',
      source,
      requestId,
      actorId: updatedBy,
      before,
      after: { ...before, ...customerValues },
      transaction,
    });
    return;
  }

  const newCustomerValues = {
    ID: randomUUID(),
    TAX_NO: taxNo,
    ...customerValues,
    CREATED_DATE: Customer.sequelize.fn('GETDATE'),
    CREATED_BY: updatedBy,
    ENABLED: '1',
  };
  const createdCustomer = await Customer.create(newCustomerValues, { transaction });
  await customerLogService.recordCustomerMutation({
    customerId: newCustomerValues.ID,
    taxNo,
    action: 'insert',
    source,
    requestId,
    actorId: updatedBy,
    before: null,
    after: createdCustomer || newCustomerValues,
    transaction,
  });
}

function normalizeCreditSuggestionId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw validationError(`${field} must be a valid ID.`);
  return value;
}

function normalizeRequestCreditSuggestion(payload) {
  const fields = [
    'PROPOSED_TERM_ID', 'PROPOSED_LIMIT_AMOUNT', 'PROPOSED_RATING_ID',
    'IS_TERM_PROPOSED', 'IS_LIMIT_PROPOSED',
    'PROPOSED_DISPLAYED_NOTES', 'PROPOSED_NOTES',
    'IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED', 'IS_WITHIN_APPROVED_LIMIT_PROPOSED',
    'IS_BANK_GUARANTEE_PROPOSED', 'PROPOSED_BANK_GUARANTEE_AMOUNT',
    'IS_CASH_DEPOSIT_PROPOSED', 'PROPOSED_CASH_DEPOSIT_AMOUNT',
    'IS_PERMANENT_PROPOSED', 'IS_TEMPORARY_PROPOSED',
    'PROPOSED_VALID_FROM', 'PROPOSED_VALID_TO',
  ];
  const update = {};

  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) update[field] = payload[field];
  });

  if (!Object.keys(update).length) throw validationError('No credit suggestion fields were supplied.');
  update.PROPOSED_TERM_ID = normalizeCreditSuggestionId(update.PROPOSED_TERM_ID, 'PROPOSED_TERM_ID');
  update.PROPOSED_RATING_ID = normalizeCreditSuggestionId(update.PROPOSED_RATING_ID, 'PROPOSED_RATING_ID');

  ['PROPOSED_DISPLAYED_NOTES', 'PROPOSED_NOTES'].forEach((field) => {
    if (update[field] === undefined) return;
    if (typeof update[field] !== 'string') throw validationError(`${field} must be a string.`);
    if (Buffer.byteLength(update[field], 'utf8') > MAX_RICH_TEXT_SIZE) {
      throw validationError(`${field} exceeds the maximum length.`);
    }
  });

  const limit = update.PROPOSED_LIMIT_AMOUNT;
  if (limit === undefined || limit === null || limit === '') {
    update.PROPOSED_LIMIT_AMOUNT = 0;
  } else {
    const normalizedLimit = Number(limit);
    if (!Number.isFinite(normalizedLimit) || normalizedLimit < 0) {
      throw validationError('PROPOSED_LIMIT_AMOUNT must be a non-negative number.');
    }
    update.PROPOSED_LIMIT_AMOUNT = normalizedLimit;
  }

  update.IS_TERM_PROPOSED = Boolean(update.PROPOSED_TERM_ID);
  update.IS_LIMIT_PROPOSED = update.PROPOSED_LIMIT_AMOUNT !== 0;

  [
    'IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED', 'IS_WITHIN_APPROVED_LIMIT_PROPOSED',
    'IS_BANK_GUARANTEE_PROPOSED', 'IS_CASH_DEPOSIT_PROPOSED',
    'IS_PERMANENT_PROPOSED', 'IS_TEMPORARY_PROPOSED',
  ].forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(update, field)) return;
    if (typeof update[field] === 'boolean') return;
    if (update[field] === 0 || update[field] === 1) {
      update[field] = Boolean(update[field]);
      return;
    }
    if (update[field] === '0' || update[field] === '1') {
      update[field] = update[field] === '1';
      return;
    }
    throw validationError(`${field} must be a boolean.`);
  });

  [
    'PROPOSED_BANK_GUARANTEE_AMOUNT', 'PROPOSED_CASH_DEPOSIT_AMOUNT',
  ].forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(update, field)) return;
    if (update[field] === undefined || update[field] === null || update[field] === '') {
      update[field] = 0;
      return;
    }
    const normalizedAmount = Number(update[field]);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
      throw validationError(`${field} must be a non-negative number.`);
    }
    update[field] = normalizedAmount;
  });

  ['PROPOSED_VALID_FROM', 'PROPOSED_VALID_TO'].forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(update, field)) return;
    if (update[field] === undefined || update[field] === null || update[field] === '') {
      update[field] = null;
      return;
    }
    if (typeof update[field] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(update[field])) {
      throw validationError(`${field} must use YYYY-MM-DD.`);
    }
    const parsedDate = new Date(`${update[field]}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== update[field]) {
      throw validationError(`${field} must be a valid calendar date.`);
    }
  });

  if (update.IS_PERMANENT_PROPOSED && !update.PROPOSED_VALID_FROM) {
    throw validationError('PROPOSED_VALID_FROM is required for a permanent adjustment.');
  }
  if (update.IS_TEMPORARY_PROPOSED && (!update.PROPOSED_VALID_FROM || !update.PROPOSED_VALID_TO)) {
    throw validationError('PROPOSED_VALID_FROM and PROPOSED_VALID_TO are required for a temporary adjustment.');
  }

  return update;
}

async function updateRequestCreditSuggestion(id, payload, updatedBy) {
  const { Request, Rating, Term } = getModels();
  const update = normalizeRequestCreditSuggestion(payload);
  const request = await Request.findOne({ where: { ID: id, ENABLED: true } });

  if (!request) return null;
  if (update.PROPOSED_TERM_ID) {
    const term = await Term.findByPk(update.PROPOSED_TERM_ID);
    if (!term) throw validationError('PROPOSED_TERM_ID must reference a valid term.');
  }
  if (update.PROPOSED_RATING_ID) {
    const rating = await Rating.findOne({ where: { ID: update.PROPOSED_RATING_ID, ENABLED: '1' } });
    if (!rating) throw validationError('PROPOSED_RATING_ID must reference an enabled rating.');
  }

  ['PROPOSED_VALID_FROM', 'PROPOSED_VALID_TO'].forEach((field) => {
    if (typeof update[field] === 'string') {
      update[field] = databaseDateFromYmd(Request.sequelize, update[field]);
    }
  });

  await request.update({ ...update, UPDATED_DATE: Request.sequelize.fn('GETDATE'), UPDATED_BY: updatedBy });
  return getRequestById(id);
}

const SCORING_RATING_IDS = Object.freeze({
  NA: 'b56fb622-c57a-43dc-b0ad-afa50dad6c67',
  A: '7f6c7c4f-49ff-4bd2-9288-2d632e2c13a3',
  D: '1cc1976d-fc34-4e96-9c26-06fd03adaf7a',
  C: 'd342aa8d-a17f-4599-96d3-9b8687c58e11',
  B: '6ae7d3ee-8583-4404-8cda-f1222c42d77c',
  NO_RISK: '6692417b-a711-49c9-9015-fb232ca7d737',
});

function normalizeBooleanField(value, field) {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1 || value === '0' || value === '1') return value === 1 || value === '1';
  throw validationError(`${field} must be a boolean.`);
}

function deriveScoringRating(scores) {
  const total = scores.reduce((sum, value, index) => {
    const score = value === undefined || value === null || String(value).trim() === '' || value === '-' ? 0 : Number(value);
    if (!Number.isFinite(score) || score < 0) {
      throw validationError(`SCORING_${['PROFITABILITY', 'GROWTH', 'LIQUIDITY', 'LEVERAGE'][index]} must be a non-negative number.`);
    }
    return sum + score;
  }, 0);
  if (total <= 30) return SCORING_RATING_IDS.D;
  if (total <= 50) return SCORING_RATING_IDS.C;
  if (total <= 70) return SCORING_RATING_IDS.B;
  if (total <= 90) return SCORING_RATING_IDS.A;
  throw validationError('The total scoring value must not exceed 90.');
}

function normalizeRequestScoringAndPayment(payload) {
  const scoringFields = [
    'SCORING_PROFITABILITY', 'SCORING_GROWTH', 'SCORING_LIQUIDITY', 'SCORING_LEVERAGE',
  ];
  const paymentFields = [
    'IS_PAY_IN_ADVANCE', 'IS_PAY_ON_TIME', 'IS_OVERDUE_LT_10_DAYS', 'IS_OVERDUE_GT_10_DAYS',
    'IS_OVERDUE_GT_30_DAYS', 'IS_OVERDUE_GT_60_DAYS', 'IS_OVERDUE_GT_90_DAYS',
  ];
  const update = {};

  const categoryFields = ['IS_SCORING_GOVERMENT', 'IS_SCORING_OTHER', 'IS_SCORING_NA'];
  [...scoringFields, 'SCORING_RATING_ID', ...categoryFields, 'SCORING_NOTES', ...paymentFields, 'REF_FINANCIAL_STATEMENT_FY'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) update[field] = payload[field];
  });

  if (!Object.keys(update).length) throw validationError('No scoring or payment behavior fields were supplied.');

  scoringFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(update, field)) return;
    const value = update[field];
    update[field] = value === undefined || value === null || String(value).trim() === ''
      ? '-' : String(value);
  });

  categoryFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(update, field)) update[field] = normalizeBooleanField(update[field], field);
  });

  const activeCategories = categoryFields.filter((field) => update[field] === true);
  if (activeCategories.length > 1) throw validationError('Only one scoring category can be selected.');

  if (Object.prototype.hasOwnProperty.call(update, 'SCORING_NOTES')) {
    update.SCORING_NOTES = update.SCORING_NOTES === null || update.SCORING_NOTES === undefined
      ? '' : String(update.SCORING_NOTES).trim();
  }
  const scoringNotesText = String(update.SCORING_NOTES || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  if ((update.IS_SCORING_OTHER || update.IS_SCORING_NA) && !scoringNotesText) {
    throw validationError('SCORING_NOTES is required when Others or N/A is selected.');
  }

  if (activeCategories.length) {
    scoringFields.forEach((field) => { update[field] = '0'; });
    update.SCORING_RATING_ID = update.IS_SCORING_NA ? SCORING_RATING_IDS.NA : SCORING_RATING_IDS.NO_RISK;
  } else {
    update.SCORING_RATING_ID = deriveScoringRating(scoringFields.map((field) => update[field]));
  }

  if (Object.prototype.hasOwnProperty.call(update, 'REF_FINANCIAL_STATEMENT_FY')) {
    const value = update.REF_FINANCIAL_STATEMENT_FY;
    if (value === undefined || value === null || value === '') {
      update.REF_FINANCIAL_STATEMENT_FY = null;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
      throw validationError('REF_FINANCIAL_STATEMENT_FY must use YYYY-MM-DD.');
    }
  }

  paymentFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(update, field)) return;
    if (typeof update[field] === 'boolean') return;
    if (update[field] === 0 || update[field] === 1) {
      update[field] = Boolean(update[field]);
      return;
    }
    if (update[field] === '0' || update[field] === '1') {
      update[field] = update[field] === '1';
      return;
    }
    throw validationError(`${field} must be a boolean.`);
  });

  return update;
}

async function updateRequestScoringAndPayment(id, payload, updatedBy) {
  const { Request, Rating } = getModels();
  const update = normalizeRequestScoringAndPayment(payload);
  const request = await Request.findOne({ where: { ID: id, ENABLED: true } });

  if (!request) return null;
  if (update.SCORING_RATING_ID) {
    const rating = await Rating.findOne({ where: { ID: update.SCORING_RATING_ID, ENABLED: '1' } });
    if (!rating) throw validationError('SCORING_RATING_ID must reference an enabled rating.');
  }

  if (typeof update.REF_FINANCIAL_STATEMENT_FY === 'string') {
    update.REF_FINANCIAL_STATEMENT_FY = databaseDateFromYmd(Request.sequelize, update.REF_FINANCIAL_STATEMENT_FY);
  }

  await request.update({ ...update, UPDATED_DATE: Request.sequelize.fn('GETDATE'), UPDATED_BY: updatedBy });
  return getRequestById(id);
}

function normalizeRequestedAmount(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const normalizedValue = Number(value);
  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
    throw validationError(`${field} must be a non-negative number.`);
  }
  return normalizedValue;
}

function normalizeRequestRequestedDetails(payload) {
  const fields = [
    'IS_TERM_REQUESTED', 'IS_LIMIT_REQUESTED',
    'REQUESTED_SALES_GROUP', 'REQUESTED_CUSTOMER_TYPE', 'REQUESTED_LIMIT_AMOUNT', 'REQUESTED_TERM_ID',
    'REQUESTED_RATING_ID', 'REQUESTED_SELLING_TYPE', 'REQUESTED_EXPECTED_SALES_AMOUNT',
    'REQUESTED_DELIVERY_FREQUENCY', 'REQUESTED_ADDITIONAL_EXPECTED_AMOUNT', 'REQUESTED_NOTES', 'BDS_NOTES',
  ];
  const update = {};
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) update[field] = payload[field];
  });
  if (!Object.keys(update).length) throw validationError('No requested detail fields were supplied.');

  ['IS_TERM_REQUESTED', 'IS_LIMIT_REQUESTED'].forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(update, field)) {
      throw validationError(`${field} is required.`);
    }
    update[field] = normalizeApprovalBoolean(update[field], field);
  });

  ['REQUESTED_SALES_GROUP', 'REQUESTED_CUSTOMER_TYPE', 'REQUESTED_TERM_ID', 'REQUESTED_RATING_ID',
    'REQUESTED_SELLING_TYPE', 'REQUESTED_DELIVERY_FREQUENCY', 'REQUESTED_NOTES', 'BDS_NOTES']
    .forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(update, field)) return;
      if (update[field] === null) update[field] = '';
      const maximumLength = field === 'REQUESTED_DELIVERY_FREQUENCY' ? 50 : field === 'BDS_NOTES' ? MAX_RICH_TEXT_SIZE : 2048;
      if (typeof update[field] !== 'string' || update[field].length > maximumLength) {
        throw validationError(`${field} must be a string no longer than ${maximumLength} characters.`);
      }
      if (field === 'BDS_NOTES' && Buffer.byteLength(update[field], 'utf8') > MAX_RICH_TEXT_SIZE) {
        throw validationError(`${field} exceeds the maximum length.`);
      }
    });
  ['REQUESTED_LIMIT_AMOUNT', 'REQUESTED_EXPECTED_SALES_AMOUNT', 'REQUESTED_ADDITIONAL_EXPECTED_AMOUNT']
    .forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(update, field)) update[field] = normalizeRequestedAmount(update[field], field);
    });
  return update;
}

async function updateRequestRequestedDetails(id, payload, updatedBy) {
  const { Request, Rating, Term } = getModels();
  const update = normalizeRequestRequestedDetails(payload);
  const request = await Request.findOne({ where: { ID: id, ENABLED: true } });
  if (!request) return null;
  if (update.REQUESTED_TERM_ID) {
    const term = await Term.findByPk(update.REQUESTED_TERM_ID);
    if (!term) throw validationError('REQUESTED_TERM_ID must reference a valid term.');
  }
  if (update.REQUESTED_RATING_ID) {
    const rating = await Rating.findOne({ where: { ID: update.REQUESTED_RATING_ID, ENABLED: '1' } });
    if (!rating) throw validationError('REQUESTED_RATING_ID must reference an enabled rating.');
  }
  await request.update({ ...update, UPDATED_DATE: Request.sequelize.fn('GETDATE'), UPDATED_BY: updatedBy });
  return getRequestById(id);
}

const CLONE_FIELDS = [
  'CUSTOMER_TAX_NO', 'CUSTOMER_REGISTERED_DATE', 'CUSTOMER_REGISTERED_CAPITAL_AMOUNT', 'CUSTOMER_SIZE_ID',
  'CUSTOMER_BUSINESS_TYPE_INTER', 'CUSTOMER_CUSTOMER_TYPE_EXTER', 'CUSTOMER_DIRECTORS', 'CUSTOMER_SHAREHOLDERS',
  'SCORING_PROFITABILITY', 'SCORING_GROWTH', 'SCORING_LIQUIDITY', 'SCORING_LEVERAGE', 'SCORING_RATING_ID',
  'IS_SCORING_GOVERMENT', 'IS_SCORING_OTHER', 'SCORING_NOTES', 'IS_SCORING_NA',
  'EXISTING_PROFITABILITY', 'EXISTING_GROWTH', 'EXISTING_LIQUIDITY', 'EXISTING_LEVERAGE',
  'IS_PAY_IN_ADVANCE', 'IS_PAY_ON_TIME', 'IS_OVERDUE_LT_10_DAYS', 'IS_OVERDUE_GT_10_DAYS', 'IS_OVERDUE_GT_30_DAYS',
  'IS_OVERDUE_GT_60_DAYS', 'IS_OVERDUE_GT_90_DAYS', 'PROPOSED_DISPLAYED_NOTES', 'PROPOSED_NOTES',
  'REF_FINANCIAL_STATEMENT_FY',
];

async function cloneRequestData(targetId, sourceId, updatedBy) {
  const { Request, Rating } = getModels();
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw validationError('sourceRequestId is required.');
  const [target, source] = await Promise.all([
    Request.findOne({ where: { ID: targetId, ENABLED: true } }),
    Request.findOne({ where: { ID: sourceId, ENABLED: true } }),
  ]);
  if (!target || !source) return null;
  if (target.STATUS_ID === CANCELLED_STATUS_ID || target.STATUS_ID === COMPLETED_STATUS_ID) {
    const error = new Error('Request data cannot be cloned into a cancelled or completed request.');
    error.statusCode = 409;
    error.code = 'REQUEST_NOT_EDITABLE';
    throw error;
  }
  if (source.ID === target.ID) {
    const error = new Error('A request cannot clone its own data.');
    error.statusCode = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }
  const update = {};
  CLONE_FIELDS.forEach((field) => { update[field] = source[field]; });
  update.CUSTOMER_REGISTERED_DATE = normalizeCloneDate(update.CUSTOMER_REGISTERED_DATE);
  update.REF_FINANCIAL_STATEMENT_FY = normalizeCloneDate(update.REF_FINANCIAL_STATEMENT_FY);
  if (update.CUSTOMER_REGISTERED_DATE) {
    update.CUSTOMER_REGISTERED_DATE = databaseDateFromYmd(Request.sequelize, update.CUSTOMER_REGISTERED_DATE);
  }
  if (update.REF_FINANCIAL_STATEMENT_FY) {
    update.REF_FINANCIAL_STATEMENT_FY = databaseDateFromYmd(Request.sequelize, update.REF_FINANCIAL_STATEMENT_FY);
  }
  if (update.SCORING_RATING_ID) {
    const rating = await Rating.findOne({ where: { ID: update.SCORING_RATING_ID, ENABLED: '1' } });
    if (!rating) throw validationError('SCORING_RATING_ID must reference an enabled rating.');
  }
  const originalValues = {};
  CLONE_FIELDS.forEach((field) => { originalValues[field] = target[field]; });
  const databaseNow = Request.sequelize.fn('GETDATE');
  await target.update({ ...update, UPDATED_DATE: databaseNow, UPDATED_BY: updatedBy });
  try {
    const attachments = await attachmentService.cloneFinancialAnalysisAttachments(sourceId, targetId, updatedBy);
    return { request: await getRequestById(targetId), attachments };
  } catch (error) {
    await target.update({ ...originalValues, UPDATED_DATE: Request.sequelize.fn('GETDATE'), UPDATED_BY: updatedBy });
    throw error;
  }
}

async function cancelRequest(id, updatedBy, cancelledNotes) {
  const { Request } = getModels();
  const normalizedNotes = typeof cancelledNotes === 'string'
    ? cancelledNotes.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim()
    : '';
  if (!normalizedNotes) throw validationError('Cancellation reason is required.');

  const [affectedRows] = await Request.update(
    {
      STATUS_ID: CANCELLED_STATUS_ID,
      CANCELLED_NOTES: cancelledNotes,
      UPDATED_DATE: Request.sequelize.fn('GETDATE'),
      UPDATED_BY: updatedBy,
    },
    { where: { ID: id, ENABLED: true } },
  );

  return affectedRows > 0;
}

function normalizeApprovalBoolean(value, field) {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return Boolean(value);
  if (value === '0' || value === '1') return value === '1';
  throw validationError(`${field} must be a boolean.`);
}

function normalizeApprovalAmount(value, field, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw validationError(`${field} must be a non-negative number.`);
  }
  return amount;
}

function normalizeApprovalDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${field} must use YYYY-MM-DD.`);
  }
  const parsedDate = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) {
    throw validationError(`${field} must be a valid calendar date.`);
  }
  return value;
}

function normalizeApprovalId(value, field, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim()) throw validationError(`${field} is required.`);
  return value.trim();
}

function normalizeApprovalUpdate(payload) {
  const description = typeof payload.DESCRIPTION === 'string' ? payload.DESCRIPTION.trim() : '';
  if (Buffer.byteLength(description, 'utf8') > MAX_RICH_TEXT_SIZE) {
    throw validationError('DESCRIPTION exceeds the maximum length.');
  }

  const update = {
    DESCRIPTION: description,
    LIMIT_AMOUNT: normalizeApprovalAmount(payload.LIMIT_AMOUNT, 'LIMIT_AMOUNT', true),
    TERM_ID: normalizeApprovalId(payload.TERM_ID, 'TERM_ID', true),
    RATING_ID: normalizeApprovalId(payload.RATING_ID, 'RATING_ID', true),
    IS_PERMANENT: normalizeApprovalBoolean(payload.IS_PERMANENT, 'IS_PERMANENT'),
    IS_TEMPORARY: normalizeApprovalBoolean(payload.IS_TEMPORARY, 'IS_TEMPORARY'),
    VALID_FROM: normalizeApprovalDate(payload.VALID_FROM, 'VALID_FROM'),
    VALID_TO: normalizeApprovalDate(payload.VALID_TO, 'VALID_TO'),
    IS_CLEAR_OUTSTANDING_BALANCE: normalizeApprovalBoolean(
      payload.IS_CLEAR_OUTSTANDING_BALANCE,
      'IS_CLEAR_OUTSTANDING_BALANCE',
    ),
    IS_WITHIN_APPROVED_LIMIT: normalizeApprovalBoolean(
      payload.IS_WITHIN_APPROVED_LIMIT,
      'IS_WITHIN_APPROVED_LIMIT',
    ),
    IS_BANK_GUARANTEE: normalizeApprovalBoolean(payload.IS_BANK_GUARANTEE, 'IS_BANK_GUARANTEE'),
    BANK_GUARANTEE_AMOUNT: normalizeApprovalAmount(payload.BANK_GUARANTEE_AMOUNT, 'BANK_GUARANTEE_AMOUNT'),
    IS_CASH_DEPOSIT: normalizeApprovalBoolean(payload.IS_CASH_DEPOSIT, 'IS_CASH_DEPOSIT'),
    CASH_DEPOSIT_AMOUNT: normalizeApprovalAmount(payload.CASH_DEPOSIT_AMOUNT, 'CASH_DEPOSIT_AMOUNT'),
  };

  if (update.IS_PERMANENT && update.IS_TEMPORARY) {
    throw validationError('IS_PERMANENT and IS_TEMPORARY cannot both be enabled.');
  }
  if ((update.IS_PERMANENT || update.IS_TEMPORARY) && !update.VALID_FROM) {
    throw validationError('VALID_FROM is required for a credit adjustment.');
  }
  if (update.IS_TEMPORARY && !update.VALID_TO) {
    throw validationError('VALID_TO is required for a temporary adjustment.');
  }
  if (update.VALID_FROM && update.VALID_TO && update.VALID_TO < update.VALID_FROM) {
    throw validationError('VALID_TO must be on or after VALID_FROM.');
  }

  return update;
}

async function saveFinalApproval(id, payload, updatedBy, isSystemAdmin = false, auditBy = updatedBy) {
  const normalizedUpdate = normalizeApprovalUpdate(payload);
  const { Request } = getModels();
  const database = getDatabase();
  const transaction = await database.transaction();
  try {
    const permissionRows = await database.query(
      `SELECT TOP 1 TB1.ID, TB1.APPROVER_ID
       FROM REQUESTS AS TB1
       WHERE CONVERT(VARCHAR(36), TB1.ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
         AND TB1.ENABLED = '1'
         AND CONVERT(VARCHAR(36), TB1.STATUS_ID) COLLATE DATABASE_DEFAULT
           = CONVERT(VARCHAR(36), :finalStatusId) COLLATE DATABASE_DEFAULT
         AND (
           :isSystemAdmin = 1
           OR TRY_CONVERT(BIGINT, TB1.SUBMITTED_BY) = TRY_CONVERT(BIGINT, :updatedBy)
           OR EXISTS (
             SELECT 1
             FROM APPROVALS AS TB2
             WHERE CONVERT(VARCHAR(36), TB2.REQUEST_ID) COLLATE DATABASE_DEFAULT
                 = CONVERT(VARCHAR(36), TB1.ID) COLLATE DATABASE_DEFAULT
               AND TRY_CONVERT(BIGINT, TB2.APPROVER_ID) = TRY_CONVERT(BIGINT, :updatedBy)
               AND TB2.APPROVAL_STEP = 2
               AND TB2.ENABLED = '1'
               AND EXISTS (
                 SELECT 1
                 FROM APPROVER_TYPES AS TB3
                 WHERE CONVERT(VARCHAR(36), TB3.ID) COLLATE DATABASE_DEFAULT
                     = CONVERT(VARCHAR(36), TB2.APPROVER_TYPE_ID) COLLATE DATABASE_DEFAULT
                   AND TB3.ENABLED = '1'
                   AND (
                     TB3.NAME COLLATE DATABASE_DEFAULT LIKE '%BDS%' COLLATE DATABASE_DEFAULT
                     OR TB3.NAME COLLATE DATABASE_DEFAULT LIKE '%Review%' COLLATE DATABASE_DEFAULT
                   )
               )
           )
         )`,
      {
        replacements: {
          id,
          updatedBy,
          isSystemAdmin: isSystemAdmin ? 1 : 0,
          finalStatusId: FINAL_STATUS_ID,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    if (!permissionRows[0]) {
      const error = new Error('Only a BDS Review approver or System Admin can save final approval data.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    await Request.update(
      {
        APPROVED_LIMIT_AMOUNT: normalizedUpdate.LIMIT_AMOUNT,
        APPROVED_TERM_ID: normalizedUpdate.TERM_ID,
        IS_LIMIT_APPROVED: Number(normalizedUpdate.LIMIT_AMOUNT ?? 0) !== 0,
        IS_TERM_APPROVED: Boolean(normalizedUpdate.TERM_ID),
        APPROVED_RATING_ID: normalizedUpdate.RATING_ID,
        APPROVED_VALID_FROM: normalizedUpdate.VALID_FROM
          ? databaseDateFromYmd(Request.sequelize, normalizedUpdate.VALID_FROM) : null,
        APPROVED_VALID_TO: normalizedUpdate.VALID_TO
          ? databaseDateFromYmd(Request.sequelize, normalizedUpdate.VALID_TO) : null,
        APPROVED_NOTES: normalizedUpdate.DESCRIPTION,
        IS_PERMANENT_APPROVED: normalizedUpdate.IS_PERMANENT,
        IS_TEMPORARY_APPROVED: normalizedUpdate.IS_TEMPORARY,
        UPDATED_BY: auditBy,
        UPDATED_DATE: Request.sequelize.fn('GETDATE'),
      },
      { where: { ID: id, ENABLED: true }, transaction },
    );
    await transaction.commit();
    return getRequestById(id);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function processApprovalAction(id, action, payload, updatedBy, isSystemAdmin = false, auditBy = updatedBy) {
  if (action === 'finalConfirm' || action === 'finalCancel') {
    return processFinalAction(id, action, payload, updatedBy, isSystemAdmin, auditBy);
  }
  if (!['save', 'approve', 'reject', 'backward'].includes(action)) {
    throw validationError('Unsupported approval action.');
  }
  if (typeof payload.APPROVAL_ID !== 'string' || !payload.APPROVAL_ID.trim()) {
    throw validationError('APPROVAL_ID is required.');
  }
  const normalizedUpdate = action === 'backward' ? null : normalizeApprovalUpdate(payload);

  const { Approval, Request } = getModels();
  const database = getDatabase();
  const transaction = await database.transaction();
  let isFinalApproval = false;
  try {
    const backwardPermissionClause = action === 'backward'
      ? `AND EXISTS (
           SELECT 1
           FROM APPROVER_TYPES AS TB5
           WHERE CONVERT(VARCHAR(36), TB5.ID) COLLATE DATABASE_DEFAULT
               = CONVERT(VARCHAR(36), TB1.APPROVER_TYPE_ID) COLLATE DATABASE_DEFAULT
             AND TB5.ENABLED = '1'
             AND TB5.ALLOW_BACKWARD = '1'
         )`
      : '';
    const finalSavePermissionClause = action === 'save'
      ? `OR (
           :allowFinalSave = 1
           AND CONVERT(VARCHAR(36), TB3.STATUS_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :finalStatusId) COLLATE DATABASE_DEFAULT
         )`
      : '';
    const pendingApprovals = await database.query(
      `SELECT TOP 1 TB1.ID, TB1.APPROVER_ID, TB1.APPROVAL_STEP
       FROM APPROVALS AS TB1
       INNER JOIN APPROVAL_TYPES AS TB2
         ON CONVERT(VARCHAR(36), TB2.ID) COLLATE DATABASE_DEFAULT
          = CONVERT(VARCHAR(36), TB1.APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
       INNER JOIN REQUESTS AS TB3
         ON CONVERT(VARCHAR(36), TB3.ID) COLLATE DATABASE_DEFAULT
          = CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT
       WHERE CONVERT(VARCHAR(36), TB1.ID) COLLATE DATABASE_DEFAULT
           = CONVERT(VARCHAR(36), :approvalId) COLLATE DATABASE_DEFAULT
         AND CONVERT(VARCHAR(36), TB1.REQUEST_ID) COLLATE DATABASE_DEFAULT
           = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
         AND (
           TRY_CONVERT(BIGINT, TB1.APPROVER_ID) = TRY_CONVERT(BIGINT, :updatedBy)
           OR :isSystemAdmin = 1
           ${finalSavePermissionClause}
         )
         AND TB1.ENABLED = '1'
         AND TB2.ENABLED = '1'
         AND (
           (
             TB2.NAME COLLATE DATABASE_DEFAULT = 'Pending' COLLATE DATABASE_DEFAULT
             AND CONVERT(VARCHAR(36), TB3.STATUS_ID) COLLATE DATABASE_DEFAULT
               = CONVERT(VARCHAR(36), :waitingStatusId) COLLATE DATABASE_DEFAULT
             AND TB1.APPROVAL_STEP = (
               SELECT MIN(TB4.APPROVAL_STEP)
               FROM APPROVALS AS TB4
               WHERE CONVERT(VARCHAR(36), TB4.REQUEST_ID) COLLATE DATABASE_DEFAULT
                   = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
                 AND CONVERT(VARCHAR(36), TB4.APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
                   = CONVERT(VARCHAR(36), :pendingApprovalTypeId) COLLATE DATABASE_DEFAULT
                 AND TB4.ENABLED = '1'
             )
           )
           ${finalSavePermissionClause}
         )
         ${backwardPermissionClause}
       ORDER BY TB1.SORTING ASC`,
      {
        replacements: {
          id,
          approvalId: payload.APPROVAL_ID.trim(),
          updatedBy,
          isSystemAdmin: isSystemAdmin ? 1 : 0,
          waitingStatusId: WAITING_APPROVAL_STATUS_ID,
          pendingApprovalTypeId: PENDING_APPROVAL_TYPE_ID,
          ...(action === 'save' ? {
            allowFinalSave: 1,
            finalStatusId: FINAL_STATUS_ID,
          } : {}),
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    const pendingApproval = pendingApprovals[0];
    if (!pendingApproval) {
      const error = new Error('There is no pending approval assigned to the authenticated user.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    if (action === 'backward') {
      await Approval.update(
        {
          APPROVAL_TYPE_ID: BACKWARD_APPROVAL_TYPE_ID,
          DESCRIPTION: payload.DESCRIPTION,
          UPDATED_BY: auditBy,
          UPDATED_DATE: Approval.sequelize.fn('GETDATE'),
        },
        {
          where: { ID: pendingApproval.ID, REQUEST_ID: id, ENABLED: true },
          transaction,
        },
      );
      await Approval.update(
        {
          ENABLED: false,
          UPDATED_BY: auditBy,
          UPDATED_DATE: Approval.sequelize.fn('GETDATE'),
        },
        {
          where: { REQUEST_ID: id, ENABLED: true },
          transaction,
        },
      );
      await Request.update(
        {
          STATUS_ID: DRAFT_STATUS_ID,
          CANCELLED_NOTES: payload.DESCRIPTION,
          UPDATED_BY: auditBy,
          UPDATED_DATE: Request.sequelize.fn('GETDATE'),
        },
        { where: { ID: id, ENABLED: true }, transaction },
      );
      await transaction.commit();
      return getRequestById(id);
    }

    const approvalUpdate = {
      ...normalizedUpdate,
      VALID_FROM: normalizedUpdate.VALID_FROM
        ? databaseDateFromYmd(Approval.sequelize, normalizedUpdate.VALID_FROM)
        : null,
      VALID_TO: normalizedUpdate.VALID_TO
        ? databaseDateFromYmd(Approval.sequelize, normalizedUpdate.VALID_TO)
        : null,
      UPDATED_BY: auditBy,
      UPDATED_DATE: Approval.sequelize.fn('GETDATE'),
    };

    if (action !== 'save') {
      const approvalTypeName = APPROVAL_ACTION_TYPES[action];
      const approvalTypes = await database.query(
        `SELECT TOP 1 ID
         FROM APPROVAL_TYPES
         WHERE ENABLED = '1'
           AND NAME COLLATE DATABASE_DEFAULT = :approvalTypeName COLLATE DATABASE_DEFAULT`,
        {
          replacements: { approvalTypeName },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const approvalType = approvalTypes[0];
      if (!approvalType) throw validationError(`Approval type ${approvalTypeName} is not configured.`);
      approvalUpdate.APPROVAL_TYPE_ID = approvalType.ID;
    }

    const [affectedRows] = await Approval.update(
      approvalUpdate,
      { where: { ID: pendingApproval.ID, REQUEST_ID: id, ENABLED: true }, transaction },
    );
    if (affectedRows === 0) throw validationError('The pending approval could not be updated.');

    if (action === 'approve') {
      await database.query(
        `UPDATE APPROVALS
         SET DESCRIPTION = :description,
             LIMIT_AMOUNT = :limitAmount,
             TERM_ID = :termId,
             RATING_ID = :ratingId,
             IS_PERMANENT = :isPermanent,
             IS_TEMPORARY = :isTemporary,
             VALID_FROM = :validFrom,
             VALID_TO = :validTo,
             IS_CLEAR_OUTSTANDING_BALANCE = :clearOutstanding,
             IS_WITHIN_APPROVED_LIMIT = :withinLimit,
             IS_BANK_GUARANTEE = :bankGuarantee,
             BANK_GUARANTEE_AMOUNT = :bankGuaranteeAmount,
             IS_CASH_DEPOSIT = :cashDeposit,
             CASH_DEPOSIT_AMOUNT = :cashDepositAmount,
             APPROVAL_TYPE_ID = :approvedTypeId,
             UPDATED_BY = :auditBy,
             UPDATED_DATE = GETDATE()
         WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
           AND TRY_CONVERT(BIGINT, APPROVER_ID) = TRY_CONVERT(BIGINT, :approverId)
           AND CONVERT(VARCHAR(36), APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :pendingApprovalTypeId) COLLATE DATABASE_DEFAULT
           AND ENABLED = '1'`,
        {
          replacements: {
            id,
            description: normalizedUpdate.DESCRIPTION,
            limitAmount: normalizedUpdate.LIMIT_AMOUNT,
            termId: normalizedUpdate.TERM_ID,
            ratingId: normalizedUpdate.RATING_ID,
            isPermanent: normalizedUpdate.IS_PERMANENT,
            isTemporary: normalizedUpdate.IS_TEMPORARY,
            validFrom: normalizedUpdate.VALID_FROM,
            validTo: normalizedUpdate.VALID_TO,
            clearOutstanding: normalizedUpdate.IS_CLEAR_OUTSTANDING_BALANCE,
            withinLimit: normalizedUpdate.IS_WITHIN_APPROVED_LIMIT,
            bankGuarantee: normalizedUpdate.IS_BANK_GUARANTEE,
            bankGuaranteeAmount: normalizedUpdate.BANK_GUARANTEE_AMOUNT,
            cashDeposit: normalizedUpdate.IS_CASH_DEPOSIT,
            cashDepositAmount: normalizedUpdate.CASH_DEPOSIT_AMOUNT,
            approvedTypeId: approvalUpdate.APPROVAL_TYPE_ID,
            updatedBy,
            auditBy,
            approverId: pendingApproval.APPROVER_ID,
            pendingApprovalTypeId: PENDING_APPROVAL_TYPE_ID,
          },
          type: QueryTypes.UPDATE,
          transaction,
        },
      );
      await propagateApprovedValues({
        requestId: id,
        approvalId: pendingApproval.ID,
        approvalStep: pendingApproval.APPROVAL_STEP,
        updatedBy: auditBy,
        pendingApprovalTypeId: PENDING_APPROVAL_TYPE_ID,
        approvedApprovalTypeId: approvalUpdate.APPROVAL_TYPE_ID,
        transaction,
      });
    }

    if (action === 'reject') {
      await Request.update(
        {
          STATUS_ID: REJECTED_STATUS_ID,
          CANCELLED_NOTES: normalizedUpdate.DESCRIPTION,
          UPDATED_BY: auditBy,
          UPDATED_DATE: Request.sequelize.fn('GETDATE'),
        },
        { where: { ID: id, ENABLED: true }, transaction },
      );
    } else if (action === 'approve') {
      const [pendingCount] = await database.query(
        `SELECT COUNT(1) AS TOTAL
         FROM APPROVALS
         WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
           AND CONVERT(VARCHAR(36), APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :pendingApprovalTypeId) COLLATE DATABASE_DEFAULT
           AND ENABLED = '1'`,
        {
          replacements: { id, pendingApprovalTypeId: PENDING_APPROVAL_TYPE_ID },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      if (Number(pendingCount?.TOTAL) === 0) {
        isFinalApproval = true;
        await Request.update(
          {
            STATUS_ID: FINAL_STATUS_ID,
            APPROVED_LIMIT_AMOUNT: normalizedUpdate.LIMIT_AMOUNT,
            APPROVED_TERM_ID: normalizedUpdate.TERM_ID,
            IS_LIMIT_APPROVED: Number(normalizedUpdate.LIMIT_AMOUNT ?? 0) !== 0,
            IS_TERM_APPROVED: Boolean(normalizedUpdate.TERM_ID),
            APPROVED_RATING_ID: normalizedUpdate.RATING_ID,
            APPROVED_VALID_FROM: normalizedUpdate.VALID_FROM
              ? databaseDateFromYmd(Request.sequelize, normalizedUpdate.VALID_FROM)
              : null,
            APPROVED_VALID_TO: normalizedUpdate.VALID_TO
              ? databaseDateFromYmd(Request.sequelize, normalizedUpdate.VALID_TO)
              : null,
            APPROVED_NOTES: normalizedUpdate.DESCRIPTION,
            IS_PERMANENT_APPROVED: normalizedUpdate.IS_PERMANENT,
            IS_TEMPORARY_APPROVED: normalizedUpdate.IS_TEMPORARY,
            UPDATED_BY: auditBy,
            UPDATED_DATE: Request.sequelize.fn('GETDATE'),
          },
          { where: { ID: id, ENABLED: true }, transaction },
        );
      } else {
        await Request.update(
          {
            UPDATED_BY: auditBy,
            UPDATED_DATE: Request.sequelize.fn('GETDATE'),
          },
          { where: { ID: id, ENABLED: true }, transaction },
        );
      }
    } else if (action === 'save') {
      await Request.update(
        {
          UPDATED_BY: auditBy,
          UPDATED_DATE: Request.sequelize.fn('GETDATE'),
        },
        { where: { ID: id, ENABLED: true }, transaction },
      );
    }

    await transaction.commit();
    const request = await getRequestById(id);
    if (request && typeof request === 'object') request.isFinalApproval = isFinalApproval;
    return request;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function processFinalAction(id, action, payload, updatedBy, isSystemAdmin = false, auditBy = updatedBy) {
  const comment = typeof payload?.DESCRIPTION === 'string' ? payload.DESCRIPTION.trim() : '';
  if (action === 'finalCancel' && !comment) {
    throw validationError('Comment is required when cancelling a final request.');
  }

  const normalizedUpdate = action === 'finalConfirm' ? normalizeApprovalUpdate(payload) : null;
  const { Request } = getModels();
  const database = getDatabase();
  const transaction = await database.transaction();
  try {
    const permissionRows = await database.query(
      `SELECT TOP 1 TB1.ID
       FROM REQUESTS AS TB1
       WHERE CONVERT(VARCHAR(36), TB1.ID) COLLATE DATABASE_DEFAULT = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
         AND TB1.ENABLED = '1'
         AND CONVERT(VARCHAR(36), TB1.STATUS_ID) COLLATE DATABASE_DEFAULT
           = CONVERT(VARCHAR(36), :finalStatusId) COLLATE DATABASE_DEFAULT
         AND (
           :isSystemAdmin = 1
           OR TRY_CONVERT(BIGINT, TB1.SUBMITTED_BY) = TRY_CONVERT(BIGINT, :updatedBy)
           OR EXISTS (
             SELECT 1
             FROM APPROVALS AS TB2
             WHERE CONVERT(VARCHAR(36), TB2.REQUEST_ID) COLLATE DATABASE_DEFAULT
                 = CONVERT(VARCHAR(36), TB1.ID) COLLATE DATABASE_DEFAULT
               AND TRY_CONVERT(BIGINT, TB2.APPROVER_ID) = TRY_CONVERT(BIGINT, :updatedBy)
               AND TB2.APPROVAL_STEP = 2
               AND TB2.ENABLED = '1'
               AND EXISTS (
                 SELECT 1
                 FROM APPROVER_TYPES AS TB3
                 WHERE CONVERT(VARCHAR(36), TB3.ID) COLLATE DATABASE_DEFAULT
                     = CONVERT(VARCHAR(36), TB2.APPROVER_TYPE_ID) COLLATE DATABASE_DEFAULT
                   AND TB3.ENABLED = '1'
                   AND (
                     TB3.NAME COLLATE DATABASE_DEFAULT LIKE '%BDS%' COLLATE DATABASE_DEFAULT
                     OR TB3.NAME COLLATE DATABASE_DEFAULT LIKE '%Review%' COLLATE DATABASE_DEFAULT
                   )
               )
           )
         )`,
      {
        replacements: {
          id,
          updatedBy,
          isSystemAdmin: isSystemAdmin ? 1 : 0,
          finalStatusId: FINAL_STATUS_ID,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    if (!permissionRows[0]) {
      const error = new Error('Only a BDS Review approver or System Admin can complete this request.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const update = {
      STATUS_ID: action === 'finalConfirm' ? COMPLETED_STATUS_ID : CANCELLED_STATUS_ID,
      UPDATED_BY: auditBy,
      UPDATED_DATE: Request.sequelize.fn('GETDATE'),
    };

    if (action === 'finalConfirm') {
      const approvedRows = await database.query(
          `SELECT TOP 1
            ID
         FROM APPROVALS
         WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
           AND CONVERT(VARCHAR(36), APPROVAL_TYPE_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :approvedTypeId) COLLATE DATABASE_DEFAULT
           AND ENABLED = '1'
         ORDER BY UPDATED_DATE DESC, SORTING DESC`,
        {
          replacements: {
            id,
            approvedTypeId: 'aab5ce03-1c54-48c8-8305-6b1a017b43fd',
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      const approved = approvedRows[0];
      if (!approved) throw validationError('No approved result is available for this request.');

      Object.assign(update, {
        APPROVED_LIMIT_AMOUNT: normalizedUpdate.LIMIT_AMOUNT,
        APPROVED_TERM_ID: normalizedUpdate.TERM_ID,
        IS_LIMIT_APPROVED: Number(normalizedUpdate.LIMIT_AMOUNT ?? 0) !== 0,
        IS_TERM_APPROVED: Boolean(normalizedUpdate.TERM_ID),
        APPROVED_RATING_ID: normalizedUpdate.RATING_ID,
        APPROVED_VALID_FROM: normalizedUpdate.VALID_FROM
          ? databaseDateFromYmd(Request.sequelize, normalizedUpdate.VALID_FROM)
          : null,
        APPROVED_VALID_TO: normalizedUpdate.VALID_TO
          ? databaseDateFromYmd(Request.sequelize, normalizedUpdate.VALID_TO)
          : null,
        APPROVED_NOTES: normalizedUpdate.DESCRIPTION,
        IS_PERMANENT_APPROVED: normalizedUpdate.IS_PERMANENT,
        IS_TEMPORARY_APPROVED: normalizedUpdate.IS_TEMPORARY,
      });
    } else {
      Object.assign(update, {
        APPROVED_NOTES: comment,
        CANCELLED_NOTES: comment,
      });
    }

    await Request.update(update, { where: { ID: id, ENABLED: true }, transaction });
    await transaction.commit();
  } catch (error) {
    if (!transaction.finished) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        error.rollbackError = {
          message: rollbackError.message,
          code: rollbackError.code,
        };
      }
    }
    throw error;
  }

  return getRequestById(id);
}

async function changeRequestStatus(id, statusId, updatedBy, updateApprovers = false, approveAllApprovers = false) {
  const allowedStatuses = new Set([
    DRAFT_STATUS_ID,
    WAITING_APPROVAL_STATUS_ID,
    FINAL_STATUS_ID,
    COMPLETED_STATUS_ID,
  ]);
  if (typeof statusId !== 'string' || !allowedStatuses.has(statusId)) {
    throw validationError('Unsupported request status.');
  }
  if (!Number.isInteger(updatedBy)) {
    throw validationError('A numeric employee code is required to change request status.');
  }
  if (typeof updateApprovers !== 'boolean') {
    throw validationError('updateApprovers must be a boolean.');
  }
  if (typeof approveAllApprovers !== 'boolean') {
    throw validationError('approveAllApprovers must be a boolean.');
  }

  const database = getDatabase();
  const transaction = await database.transaction();
  try {
    const requestRows = await database.query(
      `SELECT TOP 1 TB1.ID, TB1.STATUS_ID
       FROM REQUESTS AS TB1 WITH (UPDLOCK, ROWLOCK)
       WHERE CONVERT(VARCHAR(36), TB1.ID) COLLATE DATABASE_DEFAULT
           = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
         AND TB1.ENABLED = '1'`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    const request = requestRows[0];
    if (!request) throw notFoundError(`Request ${id} was not found.`);
    if (String(request.STATUS_ID).toLowerCase() === statusId.toLowerCase()) {
      throw conflictError('The request already has this status.');
    }

    if (statusId === WAITING_APPROVAL_STATUS_ID) {
      const assignedRows = await database.query(
        `SELECT TOP 1 ID
         FROM APPROVALS
         WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT`,
        { replacements: { id }, type: QueryTypes.SELECT, transaction },
      );
      if (!assignedRows[0]) {
        throw validationError('Waiting-Approval requires at least one assigned approver.');
      }
    }

    let finalApproval = null;
    if (statusId === COMPLETED_STATUS_ID && updateApprovers) {
      const finalApprovalRows = await database.query(
        `SELECT TOP 1
           LIMIT_AMOUNT, TERM_ID, RATING_ID, VALID_FROM, VALID_TO, DESCRIPTION,
           IS_PERMANENT, IS_TEMPORARY
         FROM APPROVALS
         WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
           AND ENABLED = '1'
         ORDER BY UPDATED_DATE DESC, SORTING DESC`,
        { replacements: { id }, type: QueryTypes.SELECT, transaction },
      );
      finalApproval = finalApprovalRows[0] || null;
    }

    if (approveAllApprovers) {
      await database.query(
        `UPDATE APPROVALS
         SET APPROVAL_TYPE_ID = :approvedTypeId,
             UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
         WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
             = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
           AND ENABLED = '1'`,
        {
          replacements: { id, updatedBy, approvedTypeId: APPROVED_APPROVAL_TYPE_ID },
          type: QueryTypes.UPDATE,
          transaction,
        },
      );
    } else if (updateApprovers) {
      if (statusId === DRAFT_STATUS_ID) {
        await database.query(
          `UPDATE APPROVALS
           SET ENABLED = '0', UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
           WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
               = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT`,
          { replacements: { id, updatedBy }, type: QueryTypes.UPDATE, transaction },
        );
      } else if (statusId === WAITING_APPROVAL_STATUS_ID) {
        await database.query(
          `UPDATE APPROVALS
           SET ENABLED = '1', APPROVAL_TYPE_ID = :pendingTypeId,
               UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
           WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
               = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT`,
          {
            replacements: { id, updatedBy, pendingTypeId: PENDING_APPROVAL_TYPE_ID },
            type: QueryTypes.UPDATE,
            transaction,
          },
        );
      } else {
        await database.query(
          `UPDATE APPROVALS
           SET APPROVAL_TYPE_ID = :approvedTypeId,
               UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
           WHERE CONVERT(VARCHAR(36), REQUEST_ID) COLLATE DATABASE_DEFAULT
               = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
             AND ENABLED = '1'`,
          {
            replacements: { id, updatedBy, approvedTypeId: APPROVED_APPROVAL_TYPE_ID },
            type: QueryTypes.UPDATE,
            transaction,
          },
        );
      }
    }

    const requestUpdate = {
      STATUS_ID: statusId,
      UPDATED_BY: updatedBy,
    };
    if (statusId === COMPLETED_STATUS_ID && updateApprovers && finalApproval) {
      requestUpdate.APPROVED_LIMIT_AMOUNT = finalApproval.LIMIT_AMOUNT;
      requestUpdate.APPROVED_TERM_ID = finalApproval.TERM_ID;
      requestUpdate.IS_LIMIT_APPROVED = Number(finalApproval.LIMIT_AMOUNT || 0) !== 0;
      requestUpdate.IS_TERM_APPROVED = Boolean(finalApproval.TERM_ID);
      requestUpdate.APPROVED_RATING_ID = finalApproval.RATING_ID;
      requestUpdate.APPROVED_VALID_FROM = finalApproval.VALID_FROM;
      requestUpdate.APPROVED_VALID_TO = finalApproval.VALID_TO;
      requestUpdate.APPROVED_NOTES = finalApproval.DESCRIPTION;
      requestUpdate.IS_PERMANENT_APPROVED = finalApproval.IS_PERMANENT;
      requestUpdate.IS_TEMPORARY_APPROVED = finalApproval.IS_TEMPORARY;
    }

    const replacements = { id, updatedBy, statusId };
    const approvedAssignments = Object.entries(requestUpdate)
      .filter(([field]) => !['STATUS_ID', 'UPDATED_BY'].includes(field));
    const approvedColumns = approvedAssignments.map(([field]) => `${field} = :${field}`).join(',\n             ');
    approvedAssignments.forEach(([field, value]) => { replacements[field] = value; });
    await database.query(
      `UPDATE REQUESTS
       SET STATUS_ID = :statusId, UPDATED_BY = :updatedBy, UPDATED_DATE = GETDATE()
           ${approvedColumns ? `,\n           ${approvedColumns}` : ''}
       WHERE CONVERT(VARCHAR(36), ID) COLLATE DATABASE_DEFAULT
           = CONVERT(VARCHAR(36), :id) COLLATE DATABASE_DEFAULT
         AND ENABLED = '1'`,
      { replacements, type: QueryTypes.UPDATE, transaction },
    );

    await transaction.commit();
  } catch (error) {
    if (!transaction.finished) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        error.rollbackError = { message: rollbackError.message, code: rollbackError.code };
      }
    }
    throw error;
  }

  return getRequestById(id);
}

module.exports = {
  listRequests,
  getRequestById,
  getCompanyCode,
  listApprovalHistory,
  getApprovalSubmitOptions,
  submitRequest,
  updateRequestCustomerInfo,
  updateRequestCreditSuggestion,
  updateRequestScoringAndPayment,
  updateRequestRequestedDetails,
  saveFinalApproval,
  cloneRequestData,
  cancelRequest,
  processApprovalAction,
  changeRequestStatus,
};
