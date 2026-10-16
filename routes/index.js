const express = require('express');
const config = require('../config/env');
const logger = require('../config/logger');

/**
 * Shared Route Loader
 * Mounts shared routes based on NODE_ENV
 * - Reads validated NODE_ENV from config
 * - Loads one shared API route module
 * - Mounts routes at /{env}/api prefix
 * - Rejects unsupported environments
 */

const router = express.Router();

/**
 * Load shared routes
 * Mounts all routes under the active environment prefix
 */
try {
  const environment = config.environment;

  logger.info(`Loading routes for environment: ${environment}`);

  const envRoutes = require('./api');

  router.use(`/${environment}/api`, envRoutes);

  logger.info(`Routes mounted at /${environment}/api`);
} catch (error) {
  logger.error(`Failed to load environment routes: ${error.message}`);
  throw error;
}

module.exports = router;
