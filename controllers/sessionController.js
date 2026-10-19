const logger = require('../config/logger');
const { recordPresence } = require('../services/sessionPresenceService');

/**
 * Session Controller
 * Handles session management endpoints
 */

/**
 * GET /{env}/api/session/ping
 * Minimal response to keep session alive
 * Used by frontend to validate session and reset idle timeout
 * Returns: 200 with minimal data + Cache-Control headers
 */
async function ping(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const user = req.user; // Set by authentication middleware

    const response = {
      success: true,
      data: {
        message: 'pong',
        timestamp: new Date().toISOString(),
      },
      correlationId,
    };

    // Cache-Control header for security
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json(response);

    logger.debug(`Session ping from ${user.oid}`, {
      correlationId,
      oid: user.oid,
    });
  } catch (error) {
    logger.error(`Error in ping: ${error.message}`, {
      correlationId: res.locals.correlationId,
      stack: error.stack,
    });
    next(error);
  }
}

async function updatePresence(req, res, next) {
  try {
    const userCode = req.user?.profile?.LOGGED_IN_CODE || req.user?.profile?.CODE;
    const { tabId, active } = req.body || {};
    if (!userCode) {
      const error = new Error('Authenticated user profile is missing an employee code.');
      error.statusCode = 403;
      error.code = 'AUTH_PROFILE_MISSING';
      throw error;
    }
    if (typeof tabId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tabId)
      || typeof active !== 'boolean') {
      const error = new Error('Request body must include a valid tabId and boolean active state.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    recordPresence({ userCode, tabId, active });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  ping,
  updatePresence,
};
