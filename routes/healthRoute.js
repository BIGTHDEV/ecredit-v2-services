const express = require('express');
const healthController = require('../controllers/homeController');

/**
 * Health Route
 * Endpoints for health checks (liveness and readiness probes)
 */

const router = express.Router();

/**
 * GET /{env}/api/health/live
 * Liveness probe - indicates if application is running
 * No authentication required
 */
router.get('/live', healthController.getHealthStatus);

/**
 * GET /{env}/api/health/ready
 * Readiness probe - indicates if application is ready to handle requests
 * Checks database connectivity
 * No authentication required
 */
router.get('/ready', healthController.getHealthStatus);

module.exports = router;
