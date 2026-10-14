const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');
const config = require('./config/env');
const logger = require('./config/logger');
const { initializeDatabase, getDatabase, closeDatabase } = require('./config/database');
const { initModels } = require('./models');
const { createHttpsServer } = require('./config/https');
const correlationIdMiddleware = require('./middlewares/correlationId');
const corsMiddleware = require('./middlewares/cors');
const requestLoggerMiddleware = require('./middlewares/requestLogger');
const errorHandlerMiddleware = require('./middlewares/errorHandler');
const environmentRouter = require('./routes');

/**
 * Express Server Application
 * Main entry point for the e-Credit backend API
 * 
 * Initialization sequence:
 * 1. Validate environment configuration
 * 2. Initialize logger
 * 3. Connect to database
 * 4. Load HTTPS certificates
 * 5. Create Express app with middleware
 * 6. Mount routes
 * 7. Start HTTPS server
 * 8. Handle graceful shutdown
 */

// Create Express application
const app = express();

/**
 * Middleware Configuration (in order)
 * 1. Helmet - Security headers
 * 2. Correlation ID - Request tracing
 * 3. CORS - Cross-origin requests
 * 4. Express JSON - Request body parsing
 * 5. Express URL-encoded - Form data parsing
 * 6. Rate Limiting - Protect against abuse
 * 7. Request Logger - Log incoming requests
 * 8. Environment Router - Route to appropriate environment handler
 * 9. Error Handler - Catch unhandled errors
 */

// Security headers (HTTPS-only)
app.use(helmet({
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// HTTPS-only redirect (if accessed via HTTP, would be caught upstream)
// This logs attempts to use insecure protocol
app.use((req, res, next) => {
  if (req.protocol !== 'https') {
    logger.warn('Insecure protocol detected', {
      protocol: req.protocol,
      url: req.url,
      ip: req.ip,
    });
    return res.status(403).json({
      success: false,
      error: {
        code: 'HTTPS_REQUIRED',
        message: 'This API requires HTTPS. Please use a secure connection.',
      },
      correlationId: res.locals.correlationId || 'N/A',
    });
  }
  next();
});

// Correlation ID for request tracing
app.use(correlationIdMiddleware);

// CORS configuration
app.use(corsMiddleware());

// Request body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});
// app.use(limiter);

// Request logging
app.use(requestLoggerMiddleware);

// Environment-specific routes
// Mounts /dev/api, /qas/api, or /prd/api based on NODE_ENV
app.use(environmentRouter);

// 404 Handler - Not Found
app.use((req, res) => {
  const correlationId = res.locals.correlationId || 'N/A';
  
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `The requested resource ${req.method} ${req.path} was not found.`,
    },
    correlationId,
  });
});

// Centralized error handler (must be last)
app.use(errorHandlerMiddleware);

/**
 * Server Initialization
 */
let server;
let isShuttingDown = false;

async function startServer() {
  try {
    logger.info('Starting e-Credit Express API...');
    logger.info(`Environment: ${config.environment}`);
    logger.info(`Port: ${config.port}`);

    // Initialize database
    logger.info('Initializing database connection...');
    await initializeDatabase();
    initModels(getDatabase());
    logger.info('Database initialized successfully');

    // Create HTTPS server
    logger.info('Loading HTTPS certificates...');
    server = createHttpsServer(app);

    // Start listening
    server.listen(config.port, () => {
      logger.info(`✓ HTTPS server listening on port ${config.port}`);
      logger.info(`✓ API available at: https://localhost:${config.port}/${config.environment}/api`);
      logger.info(`✓ Swagger UI available at: https://localhost:${config.port}/${config.environment}/api/docs`);

      if (!config.isDevelopment()) {
        // eslint-disable-next-line no-console
        console.log(
          `[STARTUP] ${config.environment.toUpperCase()} API started successfully at https://localhost:${config.port}/${config.environment}/api`,
        );
      }
    });
  } catch (error) {
    logger.error(`Fatal error during startup: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

/**
 * Graceful Shutdown Handler
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // Close HTTPS server
    if (server) {
      server.close(async () => {
        logger.info('HTTPS server closed');

        // Close database connection
        await closeDatabase();
        logger.info('Database connection closed');

        logger.info('✓ Graceful shutdown completed');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
      }, 30000);
    }
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Process Signal Handlers
 */
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(`Stack: ${error.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}`);
  logger.error(`Reason: ${reason}`);
  process.exit(1);
});

/**
 * Start Server
 */
startServer();

module.exports = app;
