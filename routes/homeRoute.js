const express = require('express');
const homeController = require('../controllers/homeController');

/**
 * Home Route
 * Public endpoint for basic health and API information
 */

const router = express.Router();

/**
 * GET /{env}/api/home
 * Returns basic API information
 * No authentication required
 */
router.get('/', homeController.getHome);

module.exports = router;
