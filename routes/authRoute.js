const express = require('express');
const authenticationMiddleware = require('../middlewares/authentication');
const authController = require('../controllers/authController');

/**
 * Authentication Route
 * Endpoints for user authentication and profile
 */

const router = express.Router();

/**
 * GET /{env}/api/auth/me
 * Returns authenticated user profile
 * Requires: Valid Microsoft Entra ID access token
 */
router.get('/me', authenticationMiddleware, authController.getCurrentUser);

module.exports = router;
