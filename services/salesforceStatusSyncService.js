const config = require('../config/env');
const { getModels } = require('../models');
const { recordSalesforceEndpointEvent } = require('./eventLogService');

const UPDATE_ENDPOINT = 'apexrest/Update_Credit_Rating_Credit_Limit/INTG_Update_Credit_Rating_Credit_Limit/update_credit_e_credit';
const CRM_STATUS_CODES = new Map([
  ['31d531f4-0420-4db5-aecf-bcfe4a0e8c4a', '100000004'],
  ['407e23f9-caf5-4c4a-801d-598cf437d1ae', '100000001'],
  ['94589a22-12e5-4298-aa30-06295acbe1b9', '100000003'],
]);

function redactSecrets(value, secrets = []) {
  let text = String(value || '');
  [...secrets, config.crm.clientId, config.crm.clientSecret, config.crm.username, config.crm.password]
    .filter((secret) => typeof secret === 'string' && secret.length > 0)
    .forEach((secret) => { text = text.split(secret).join('[REDACTED]'); });
  return text.slice(0, 500);
}

function messageFrom(payload, fallback, secrets = []) {
  const message = [payload?.ErrMsg, payload?.error_description, payload?.error]
    .find((value) => typeof value === 'string' && value.trim());
  return message ? redactSecrets(message.trim(), secrets) : fallback;
}

async function logEndpoint(context, endpoint, result) {
  if (context === null) return;
  try {
    await recordSalesforceEndpointEvent({ ...context, endpoint, ...result });
  } catch (error) {
    console.error('Unable to persist Salesforce endpoint event log:', error.message);
  }
}

function responseSummary(endpoint, payload, secrets) {
  const fields = endpoint === 'oauth2/token'
    ? ['token_type', 'instance_url', 'issued_at', 'error', 'error_description']
    : ['Success', 'ErrMsg'];
  return Object.fromEntries(fields
    .filter((field) => payload?.[field] !== undefined)
    .map((field) => [field, ['ErrMsg', 'error_description', 'error'].includes(field)
      ? redactSecrets(payload[field], secrets)
      : payload[field]]));
}

async function postEndpoint(endpoint, body, headers, context, validateResponse, encodeBody, secrets = []) {
  const startedAt = Date.now();
  const url = `${config.crm.baseUrl}/${endpoint}`;
  let httpStatus = null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: encodeBody(body),
      signal: AbortSignal.timeout(15000),
    });
    httpStatus = response.status;
    const responseText = await response.text();
    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      payload = {};
    }

    const responseError = redactSecrets(!response.ok
      ? messageFrom(payload, `Salesforce returned HTTP ${response.status}.`, secrets)
      : validateResponse(payload) || '', secrets) || null;
    await logEndpoint(context, endpoint, {
      success: !responseError,
      httpStatus,
      durationMs: Date.now() - startedAt,
      response: responseSummary(endpoint, payload, secrets),
      message: responseError || undefined,
    });
    if (responseError) throw new Error(responseError);
    return payload;
  } catch (error) {
    const safeMessage = redactSecrets(error.message || 'Salesforce request failed.', secrets);
    if (httpStatus === null) {
      await logEndpoint(context, endpoint, {
        success: false,
        httpStatus: null,
        durationMs: Date.now() - startedAt,
        message: safeMessage,
      });
    }
    throw new Error(safeMessage);
  }
}

async function authenticate(context) {
  return postEndpoint('oauth2/token', {
    grant_type: config.crm.grantType,
    client_id: config.crm.clientId,
    client_secret: config.crm.clientSecret,
    username: config.crm.username,
    password: config.crm.password,
  }, { 'content-type': 'application/x-www-form-urlencoded' }, context,
  (payload) => typeof payload?.access_token === 'string' && payload.access_token.trim()
    ? null : messageFrom(payload, 'Salesforce OAuth response did not contain an access token.', Object.values(config.crm)),
  (body) => new URLSearchParams(body).toString(),
  Object.values(config.crm));
}

async function checkReadiness() {
  try {
    await authenticate(null);
    return { ready: true };
  } catch {
    return { ready: false };
  }
}

async function syncRequestStatus(requestId, statusId, context = {}) {
  const statusCode = CRM_STATUS_CODES.get(String(statusId || '').toLowerCase());
  if (!statusCode) return null;
  const eventContext = { ...context, requestId };

  const request = await getModels().Request.findOne({
    where: { ID: requestId, ENABLED: true },
    attributes: ['CRM_ID', 'APPROVED_LIMIT_AMOUNT', 'APPROVED_TERM_ID', 'APPROVED_RATING_ID'],
  });
  if (!request) throw new Error(`Request ${requestId} was not found after its status changed.`);
  if (!String(request.CRM_ID || '').trim()) {
    const message = 'Salesforce CRM_ID is missing for this request.';
    await logEndpoint(eventContext, UPDATE_ENDPOINT, {
      success: false,
      httpStatus: null,
      durationMs: 0,
      message,
    });
    throw new Error(message);
  }
  const approvedLimit = request.APPROVED_LIMIT_AMOUNT == null ? 0 : Number(request.APPROVED_LIMIT_AMOUNT);
  if (!Number.isFinite(approvedLimit)) {
    const message = 'Approved credit limit is invalid for the Salesforce update.';
    await logEndpoint(eventContext, UPDATE_ENDPOINT, { success: false, httpStatus: null, durationMs: 0, message });
    throw new Error(message);
  }

  const tokenResponse = await authenticate(eventContext);

  await postEndpoint(UPDATE_ENDPOINT, {
    credit: {
      credit_id: request.CRM_ID,
      credit_status: statusCode,
      credit_limit: approvedLimit,
      terms: request.APPROVED_TERM_ID == null ? '' : String(request.APPROVED_TERM_ID),
      rating: request.APPROVED_RATING_ID == null ? '' : String(request.APPROVED_RATING_ID),
    },
  }, {
    authorization: `Bearer ${tokenResponse.access_token}`,
    'content-type': 'application/json',
  }, eventContext, (payload) => payload?.Success === true
    ? null : messageFrom(payload, 'Salesforce rejected the credit update.', [tokenResponse.access_token]),
  (body) => JSON.stringify(body),
  [tokenResponse.access_token]);

  return { success: true };
}

async function syncRequestStatusSafely(requestId, statusId, context = {}) {
  try {
    const result = await syncRequestStatus(requestId, statusId, context);
    return result ? { ...result, requestId, correlationId: context.correlationId || null } : null;
  } catch (error) {
    return {
      success: false,
      message: error.message || 'Salesforce synchronization failed.',
      requestId,
      correlationId: context.correlationId || null,
    };
  }
}

module.exports = { CRM_STATUS_CODES, syncRequestStatus, syncRequestStatusSafely, checkReadiness };
