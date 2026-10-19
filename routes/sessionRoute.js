const express = require('express');
const authenticationMiddleware = require('../middlewares/authentication');
const sessionController = require('../controllers/sessionController');

/**
 * Session Route
 * Endpoints for session management
 */

const router = express.Router();

/**
 * GET /{env}/api/session/ping
 * Returns minimal response to keep session alive
 * Used by frontend to validate session and update idle timeout
 * Requires: Valid Microsoft Entra ID access token
 */
router.get('/ping', authenticationMiddleware, sessionController.ping);
/**
 * POST /{env}/api/session/presence
 * Updates the authenticated user's in-memory active/away heartbeat.
 */
router.post('/presence', authenticationMiddleware, sessionController.updatePresence);

module.exports = router;
