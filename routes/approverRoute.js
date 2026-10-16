const express = require('express');
const authenticationMiddleware = require('../middlewares/authentication');
const controller = require('../controllers/approverController');

const router = express.Router();
router.get('/', authenticationMiddleware, controller.list);
router.get('/employees', authenticationMiddleware, controller.employeeOptions);
router.get('/types', authenticationMiddleware, controller.approverTypeOptions);
router.get('/:id', authenticationMiddleware, controller.get);
router.post('/', authenticationMiddleware, controller.create);
router.patch('/:id', authenticationMiddleware, controller.update);
router.patch('/:id/active', authenticationMiddleware, controller.setActive);
router.patch('/:id/primary', authenticationMiddleware, controller.setPrimary);
router.delete('/:id', authenticationMiddleware, controller.remove);
module.exports = router;
