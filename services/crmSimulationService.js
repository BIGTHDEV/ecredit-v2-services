const config = require('../config/env');
const { randomBytes } = require('crypto');
const { getModels } = require('../models');

const ALLOWED_FIELDS = [
  'CRM_ID', 'CRM_NO', 'DESCRIPTION', 'SOLD_ID', 'SOLD_TO', 'REQUESTED_BY', 'SUBMITTED_BY',
  'REQUESTED_LIMIT_AMOUNT', 'REQUESTED_TERM_ID', 'REQUESTED_RATING_ID',
  'REQUESTED_VALID_FROM', 'REQUESTED_VALID_TO', 'REQUESTED_SALES_GROUP',
  'REQUESTED_CUSTOMER_TYPE', 'REQUESTED_SELLING_TYPE', 'REQUESTED_EXPECTED_SALES_AMOUNT',
  'REQUESTED_DELIVERY_FREQUENCY', 'REQUESTED_ADDITIONAL_EXPECTED_AMOUNT', 'REQUESTED_NOTES',
  'SCORING_RATING_ID', 'IS_PERMANENT_REQUESTED', 'IS_TEMPORARY_REQUESTED',
  'IS_TERM_REQUESTED', 'IS_LIMIT_REQUESTED',
];
const TIMEOUT_MS = 30000;
const CRM_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function createError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function buildPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError('Request body must be an object.', 400, 'VALIDATION_ERROR');
  }
  const payload = {};
  ALLOWED_FIELDS.forEach((field) => {
    if (body[field] !== undefined && body[field] !== null) payload[field] = body[field];
  });
  return payload;
}

function createCrmId() {
  const bytes = randomBytes(18);
  return Array.from(bytes, (byte) => CRM_ID_ALPHABET[byte % CRM_ID_ALPHABET.length]).join('');
}

async function generateSimulationIdentifiers({
  Request = getModels().Request,
  createId = createCrmId,
} = {}) {
  const requests = await Request.findAll({
    attributes: ['CRM_ID', 'CRM_NO'],
    raw: true,
  });
  const existingIds = new Set(
    requests.map((request) => String(request.CRM_ID || '').trim().toUpperCase()).filter(Boolean),
  );

  let crmId = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = createId();
    if (candidate && !existingIds.has(candidate.toUpperCase())) {
      crmId = candidate;
      break;
    }
  }
  if (!crmId) {
    const error = new Error('Unable to generate a unique CRM ID. Please try again.');
    error.statusCode = 503;
    error.code = 'CRM_SIMULATION_ID_GENERATION_FAILED';
    throw error;
  }

  let latestCrmNo = '';
  let latestSequence = 0n;
  for (const request of requests) {
    const value = String(request.CRM_NO || '').trim();
    const match = /^(.*?)(\d+)$/.exec(value);
    if (!match) continue;
    const sequence = BigInt(match[2]);
    if (sequence > latestSequence) {
      latestCrmNo = value;
      latestSequence = sequence;
    }
  }

  let crmNo;
  if (latestCrmNo) {
    const match = /^(.*?)(\d+)$/.exec(latestCrmNo);
    const nextSequence = (latestSequence + 1n).toString();
    crmNo = `${match[1]}${nextSequence.padStart(Math.max(match[2].length, nextSequence.length), '0')}`;
  } else {
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    crmNo = `CN-${dateStamp}001`;
  }

  return { CRM_ID: crmId, CRM_NO: crmNo };
}

// Test-only helper: posts a CRM-style "create request" call to the configured endpoint.
async function simulateCreateRequest(body, { environment = config.environment, settings = config.createRequest, fetchImpl = fetch } = {}) {
  if (!['dev', 'qas'].includes(String(environment).toLowerCase())) {
    throw createError('Not found.', 404, 'NOT_FOUND');
  }
  if (!settings.url || !settings.headerKey || !settings.headerValue) {
    throw createError('APP_CREATE_REQUEST_URL, HEADER_KEY_CREATE_REQUEST and HEADER_VALUE_CREATE_REQUEST must be configured.', 500, 'CONFIGURATION_ERROR');
  }

  const payload = buildPayload(body);
  let response;
  try {
    response = await fetchImpl(settings.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [settings.headerKey]: settings.headerValue },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw createError(`Unable to reach the create-request endpoint: ${error.cause?.message || error.message}`, 502, 'UPSTREAM_UNAVAILABLE');
  }

  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

  return { status: response.status, ok: response.ok, response: data };
}

module.exports = {
  simulateCreateRequest,
  generateSimulationIdentifiers,
  buildPayload,
  ALLOWED_FIELDS,
};
