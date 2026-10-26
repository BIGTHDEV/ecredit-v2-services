const logger = require('../config/logger');
const { persistRequestEvent } = require('../services/eventLogService');
const config = require('../config/env');

/**
 * Request Logger Middleware
 * Logs incoming HTTP requests and outgoing responses
 * - Sanitizes sensitive headers
 * - Logs response timing
 * - Uses centralized logger
 * - Includes correlation ID in all log entries
 */

/**
 * Express middleware to log requests and responses
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function requestLoggerMiddleware(req, res, next) {
  if (req.method === 'POST' && req.path === `/${config.environment}/api/health/crm`) {
    return next();
  }
  const correlationId = res.locals.correlationId || 'N/A';
  const startTime = Date.now();
  const method = req.method;
  const path = req.path;

  // Capture response finish so authenticated user context and status are available.
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    persistRequestEvent({ req, res, durationMs: duration }).catch((error) => {
      logger.error(`Unable to persist request event log: ${error.message}`, {
        correlationId,
        route: { method, path, query: req.query },
        stack: error.stack,
      });
    });
  });

  next();
}

module.exports = requestLoggerMiddleware;
