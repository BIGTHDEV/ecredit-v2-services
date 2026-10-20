const logger = require('../config/logger');
const tokenValidator = require('../helpers/tokenValidator');
const errorCodes = require('../helpers/errorCodes');
const userProfileService = require('../services/userProfileService');
const authenticated = Symbol('authenticated');

// Maintenance accepts anonymous/invalid tokens, but never hides permission lookup failures.
async function resolveOptionalIdentity(req, correlationId) {
  if (req[authenticated]) return req.user;
  const parts = (req.get('Authorization') || '').split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const validation = tokenValidator.validateToken(parts[1], correlationId);
  if (!validation.valid) return null;
  const claims = validation.claims;
  const email = claims.email || claims.preferred_username || claims.upn || '';
  const profile = await userProfileService.getUserProfileByEmail(email);
  if (!profile) return null;
  req.user = {
    oid: claims.oid, tid: claims.tid, email, displayName: claims.name,
    roles: claims.roles || [], profile,
  };
  req[authenticated] = true;
  return req.user;
}

/**
 * Authentication Middleware
 * Validates JWT access token from Microsoft Entra ID
 * - Validates signature, expiration, audience
 * - Validates issuer and tenant ID
 * - Extracts user context (oid, tid) from token
 * - Shared across all environments (dev, qas, prd)
 */

/**
 * Express middleware for JWT authentication
 * Validates authorization bearer token and extracts user context
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
async function authenticationMiddleware(req, res, next) {
  if (req[authenticated]) return next();
  const correlationId = res.locals.correlationId || 'N/A';

  try {
    // Extract authorization header
    const authHeader = req.get('Authorization');

    if (!authHeader) {
      logger.warn('Authentication failed: Missing Authorization header', {
        correlationId,
        method: req.method,
        path: req.path,
      });

      return res.status(401).json({
        success: false,
        error: {
          code: errorCodes.AUTH_MISSING_TOKEN,
          message: 'Missing authorization token. Include Authorization: Bearer <token> header.',
        },
        correlationId,
      });
    }

    // Extract bearer token
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      logger.warn('Authentication failed: Invalid Authorization header format', {
        correlationId,
        method: req.method,
        path: req.path,
      });

      return res.status(401).json({
        success: false,
        error: {
          code: errorCodes.AUTH_INVALID_TOKEN,
          message: 'Invalid authorization header. Use format: Authorization: Bearer <token>',
        },
        correlationId,
      });
    }

    const token = parts[1];

    // Validate token
    const validation = tokenValidator.validateToken(token, correlationId);

    if (!validation.valid) {
      logger.warn(`Authentication failed: ${validation.reason}`, {
        correlationId,
        method: req.method,
        path: req.path,
        reason: validation.reason,
      });

      return res.status(401).json({
        success: false,
        error: {
          code: validation.code || errorCodes.AUTH_INVALID_TOKEN,
          message: validation.message || 'Authentication token is invalid or expired.',
        },
        correlationId,
      });
    }

    // Attach user context to request object
    // Entra ID access tokens usually omit the "email" claim; fall back to preferred_username/upn
    req.user = {
      oid: validation.claims.oid,
      tid: validation.claims.tid,
      email: validation.claims.email || validation.claims.preferred_username || validation.claims.upn || '',
      displayName: validation.claims.name,
      roles: validation.claims.roles || [],
    };

    logger.debug(`Authentication successful for user ${req.user.oid}`, {
      correlationId,
      oid: req.user.oid,
      tid: req.user.tid,
    });

    // Verify the M365 email is registered in eCredit and load the permission profile
    let profile;
    try {
      profile = await userProfileService.getUserProfileByEmail(req.user.email);
    } catch (dbError) {
      logger.error(`Permission lookup failed: ${dbError.message}`, {
        correlationId,
        oid: req.user.oid,
        stack: dbError.stack,
      });

      if (dbError.code === 'INVALID_VIEW_AS_TARGET') {
        return res.status(403).json({
          success: false,
          error: {
            code: dbError.code,
            message: 'The configured View As employee could not be found. Please contact an administrator.',
          },
          correlationId,
        });
      }

      return res.status(503).json({
        success: false,
        error: {
          code: errorCodes.DATABASE_UNAVAILABLE,
          message: 'Unable to verify permissions at this time. Please try again later.',
        },
        correlationId,
      });
    }

    if (!profile) {
      logger.warn(`Authentication failed: No eCredit access for ${req.user.email}`, {
        correlationId,
        oid: req.user.oid,
        email: req.user.email,
      });

      return res.status(403).json({
        success: false,
        error: {
          code: errorCodes.FORBIDDEN,
          message: 'You do not have permission to access this system.',
        },
        correlationId,
      });
    }

    req.user.profile = profile;
    req[authenticated] = true;

    next();
  } catch (error) {
    logger.error(`Unexpected error in authentication middleware: ${error.message}`, {
      correlationId,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      error: {
        code: errorCodes.INTERNAL_ERROR,
        message: 'An authentication error occurred. Please try again.',
      },
      correlationId,
    });
  }
}

module.exports = authenticationMiddleware;
module.exports.resolveOptionalIdentity = resolveOptionalIdentity;
