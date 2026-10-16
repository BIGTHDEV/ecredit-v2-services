const logger = require('../config/logger');

/**
 * Authentication Controller
 * Handles user authentication and profile endpoints
 */

/**
 * GET /{env}/api/auth/me
 * Returns authenticated user profile
 * Requires: Valid Microsoft Entra ID access token
 */
async function getCurrentUser(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const user = req.user; // Set by authentication middleware
    const profile = { ...(user.profile || {}) };
    ['LOGGED_IN_CODE', 'LOGGED_IN_EMAIL', 'LOGGED_IN_ROLE', 'LOGGED_IN_ROLE_ID', 'LOGGED_IN_USERNAME', 'MAIN_CODE', 'MAIN_EMAIL']
      .forEach((field) => delete profile[field]);

    // Sanitize response - don't include all JWT claims
    const userProfile = {
      oid: user.oid,
      tid: user.tid,
      email: profile.EMAIL || user.email,
      displayName: profile.FULL_NAME || user.displayName,
      roles: profile.ROLES || user.roles,
      profile,
    };

    const response = {
      success: true,
      data: userProfile,
      correlationId,
    };

    // Cache-Control header for security
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json(response);

    logger.debug(`User profile returned for ${user.oid}`, {
      correlationId,
      oid: user.oid,
    });
  } catch (error) {
    logger.error(`Error in getCurrentUser: ${error.message}`, {
      correlationId: res.locals.correlationId,
      stack: error.stack,
    });
    next(error);
  }
}

/**
 * Validate session (can be extended with backend session tracking)
 */
async function validateSession(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const user = req.user;

    const response = {
      success: true,
      data: {
        valid: true,
        oid: user.oid,
      },
      correlationId,
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in validateSession: ${error.message}`, {
      correlationId: res.locals.correlationId,
      stack: error.stack,
    });
    next(error);
  }
}

/**
 * Logout (placeholder - actual logout is handled by frontend clearing MSAL cache)
 */
async function logout(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';

    const response = {
      success: true,
      data: {
        message: 'Logout initiated. Clear browser session and tokens.',
      },
      correlationId,
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error(`Error in logout: ${error.message}`, {
      correlationId: res.locals.correlationId,
      stack: error.stack,
    });
    next(error);
  }
}

module.exports = {
  getCurrentUser,
  validateSession,
  logout,
};
