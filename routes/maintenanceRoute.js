const express = require('express');
const authentication = require('../middlewares/authentication');
const controller = require('../controllers/maintenanceController');

const router = express.Router();
router.get('/', controller.get);
router.put('/', authentication, controller.update);

module.exports = router;
