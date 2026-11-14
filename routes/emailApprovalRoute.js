const express = require('express');
const controller = require('../controllers/emailApprovalController');
const optionalAuthentication = require('../middlewares/optionalAuthentication');

const router = express.Router();
router.get('/:token', optionalAuthentication, controller.getAction);
router.get('/:token/history', optionalAuthentication, controller.getHistory);
router.post('/:token/confirm', optionalAuthentication, controller.confirmAction);

module.exports = router;
