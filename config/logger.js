const winston = require('winston');
const Transport = require('winston-transport');
const { v4: uuidv4 } = require('uuid');
const config = require('./env');
const { getModels, isModelsInitialized } = require('../models');

/**
 * Logger Configuration Module
 * Sets up Winston logger with:
 * - Console transport (dev only)
 * - Database transport for durable event records
 * - Token/secret redaction
 * - Correlation ID support
 */

/**
 * List of sensitive fields to redact in logs
 */
const REDACTED_FIELDS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'access_token',
  'id_token',
  'refresh_token',
  'client_secret',
  'db_password',
  'password',
  'secret',
];

const CONSOLE_COLORS = {
  info: '\x1b[32m',
  warn: '\x1b[38;5;208m',
  error: '\x1b[31m',
  debug: '\x1b[36m',
};
const CONSOLE_COLOR_RESET = '\x1b[0m';
const LOG_TYPE_IDS = {
  info: '23556cea-337f-475c-9b6a-830bfa08ab93',
  error: '2d8e6e9d-0b7b-427f-a5ba-0e65f61d945b',
  warn: '69bd78f0-a012-4d47-bfed-4c0abd316877',
  debug: 'e5bcffe9-8d7e-4d30-b828-37de41561f25',
};

/**
 * Redact sensitive values from log message
 * @param {string} message - Log message
 * @returns {string} Redacted message
 */
function redactSensitiveData(message) {
  if (typeof message !== 'string') {
    return message;
  }

  let redacted = message;
  REDACTED_FIELDS.forEach((field) => {
    const regex = new RegExp(`(${field}\\s*[:=]\\s*)[^\\s,}]*`, 'gi');
    redacted = redacted.replace(regex, '$1***REDACTED***');
  });
  return redacted;
}

/**
 * Removes sensitive values from structured log payloads without dropping
 * the surrounding context needed to investigate a request.
 */
function redactPayload(value, fieldName = '') {
  const normalizedFieldName = fieldName.toLowerCase();
  if (REDACTED_FIELDS.includes(normalizedFieldName)) {
    return '***REDACTED***';
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactPayload(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactPayload(entry, key)]),
    );
  }

  return typeof value === 'string' ? redactSensitiveData(value) : value;
}

/**
 * Normalizes Winston's extra fields into a stable log schema.
 */
function createLogEntry(info) {
  const {
    timestamp,
    level,
    message,
    correlationId,
    route,
    method,
    path: requestPath,
    stack,
    environment,
    payload,
    ...metadata
  } = info;
  const normalizedRoute = route || (method || requestPath
    ? { method, path: requestPath }
    : undefined
  );

  const logEntry = {
    timestamp,
    env: environment || config.environment,
    level,
    correlationId: correlationId || 'N/A',
    message: redactSensitiveData(message),
  };

  if (normalizedRoute) {
    logEntry.route = redactPayload(normalizedRoute);
  }

  const combinedPayload = {
    ...(payload || {}),
    ...metadata,
  };
  if (Object.keys(combinedPayload).length > 0) {
    logEntry.payload = redactPayload(combinedPayload);
  }

  if (stack && config.isDevelopment()) {
    logEntry.stack = stack;
  }

  return logEntry;
}

function formatReadableEntry(entry) {
  const route = entry.route
    ? ` route=${entry.route.method || ''} ${entry.route.path || ''}`.trimEnd()
    : '';
  const payload = entry.payload
    ? ` payload=${JSON.stringify(entry.payload)}`
    : '';
  const stack = entry.stack ? `\n${entry.stack}` : '';

  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [env=${entry.env}] [correlationId=${entry.correlationId}]${route} ${entry.message}${payload}${stack}`;
}

function requestIdFromPath(requestPath) {
  const match = String(requestPath || '').match(/\/requests\/([^/?]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function actorCode(info) {
  const value = Number(info.actorCode ?? info.updatedBy ?? info.payload?.updatedBy);
  return Number.isSafeInteger(value) ? value : null;
}

async function persistLogEntry(info) {
  if (info.level === 'debug' && [
    /^Token validation successful$/,
    /^Authentication successful for user /,
    /^User profile returned for /,
    /^(?:Customers?|Requests?|Permissions) returned$/,
    /^Session ping from /,
  ].some((pattern) => pattern.test(String(info.message)))) return;
  if (!isModelsInitialized()) return;

  const entry = createLogEntry(info);
  const requestId = requestIdFromPath(entry.route?.path || info.path);
  const { Log } = getModels();
  const databaseNow = Log.sequelize.literal('GETDATE()');

  await Log.create({
    ID: uuidv4(),
    NAME: entry.message,
    DESCRIPTION: JSON.stringify({ ...entry, requestId }),
    LOG_TYPE_ID: LOG_TYPE_IDS[entry.level] || LOG_TYPE_IDS.debug,
    CATEGORY: requestId ? 'request.activity' : 'system.activity',
    REQUEST_ID: requestId,
    CREATED_DATE: databaseNow,
    UPDATED_DATE: databaseNow,
    CREATED_BY: actorCode(info),
    UPDATED_BY: actorCode(info),
    ENABLED: true,
  });
}

class DatabaseTransport extends Transport {
  log(info, callback) {
    setImmediate(() => this.emit('logged', info));
    persistLogEntry(info).catch((error) => {
      if (config.isDevelopment()) {
        console.error(`Unable to persist application log: ${error.message}`);
      }
    });
    callback();
  }
}

/**
 * Custom format for log entries
 */
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const entry = createLogEntry(info);
    return formatReadableEntry(entry);
  }),
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const entry = createLogEntry(info);
    const color = CONSOLE_COLORS[entry.level] || '';

    return `${color}${formatReadableEntry(entry)}${CONSOLE_COLOR_RESET}`;
  }),
);

/**
 * JSON format for logging (alternative)
 */
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => JSON.stringify(createLogEntry(info))),
);

/**
 * Select format based on environment configuration
 */
const logFormat =
  config.logging.format === 'json' ? jsonFormat : customFormat;

/**
 * Create transports array
 */
const transports = [];

// Console transport: enabled only in development
if (config.isDevelopment()) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    }),
  );
}

transports.push(new DatabaseTransport());

/**
 * Create and export logger instance
 */
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: {
    environment: config.environment,
  },
  transports,
});

logger.redactPayload = redactPayload;
logger.redactSensitiveData = redactSensitiveData;
logger.persistLogEntry = persistLogEntry;

module.exports = logger;
