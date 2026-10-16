const logger = require('../config/logger');

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

module.exports = {
  ping,
};
