const express = require('express');
const authenticationMiddleware = require('../middlewares/authentication');
const controller = require('../controllers/emailReminderController');

const router = express.Router();
router.use(authenticationMiddleware);
router.get('/', controller.list);
router.patch('/:template', controller.update);
module.exports = router;
