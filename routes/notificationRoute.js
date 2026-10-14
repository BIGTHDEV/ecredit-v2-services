const express = require('express');
const authenticationMiddleware = require('../middlewares/authentication');
const controller = require('../controllers/notificationController');

const router = express.Router();
router.get('/', authenticationMiddleware, controller.list);
router.get('/unread-count', authenticationMiddleware, controller.unreadCount);
router.patch('/read-all', authenticationMiddleware, controller.markAllRead);
router.patch('/:id/read', authenticationMiddleware, controller.markRead);
router.patch('/:id/unread', authenticationMiddleware, controller.markUnread);

module.exports = router;
