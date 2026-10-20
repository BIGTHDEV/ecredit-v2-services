const cors = require('cors');
const config = require('../config/env');
const logger = require('../config/logger');
const allowedOrigins = new Set([
  ...config.corsAllowedOrigins,
  new URL(config.frontendBaseUrl).origin,
]);

/**
 * CORS Configuration Middleware
 * Configures Cross-Origin Resource Sharing per environment
 * - Validates origins against allowlist from CORS_ALLOWED_ORIGINS
 * - Only allows configured HTTP methods and headers
 * - Allows Authorization header
 * - Responds correctly to OPTIONS preflight requests
 */

/**
 * CORS options configuration
 * Based on environment-specific allowlist
 */
const corsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (mobile, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in allowlist
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    // Reject if origin not in allowlist
    logger.warn(`CORS rejected request from origin: ${origin}`, {
      origin,
      allowedOrigins: [...allowedOrigins].join(', '),
    });

    const message = 'Not allowed by CORS policy';
    callback(new Error(message));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Correlation-ID',
    'X-Requested-With',
  ],
  exposedHeaders: ['X-Correlation-ID'],
  optionsSuccessStatus: 200,
  maxAge: 86400, // 24 hours
};

/**
 * Create CORS middleware with configured options
 * @returns {Function} Express CORS middleware
 */
function corsMiddleware() {
  return cors(corsOptions);
}

module.exports = corsMiddleware;
