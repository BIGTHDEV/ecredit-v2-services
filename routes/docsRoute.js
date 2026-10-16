const express = require('express');
const swaggerUi = require('swagger-ui-express');
const config = require('../config/env');
const { getSwaggerSpec } = require('../config/swagger');

/**
 * Documentation Route
 * Serves Swagger UI and OpenAPI specification
 */

const router = express.Router();

// Get OpenAPI spec
const swaggerSpec = getSwaggerSpec();

/**
 * GET /{env}/api/docs
 * Serves Swagger UI interface
 * No authentication required
 */
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(swaggerSpec, {
  swaggerOptions: {
    url: `/${config.environment}/api/docs/openapi.json`,
  },
}));

/**
 * GET /{env}/api/docs/openapi.json
 * Returns OpenAPI 3.x specification as JSON
 * No authentication required
 */
router.get('/openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});

module.exports = router;
