const express = require('express');
const authenticationMiddleware = require('../../middlewares/authentication');
const customerController = require('../../controllers/qas/customerController');
const customerLogController = require('../../controllers/customerLogController');

const router = express.Router();

router.get('/', authenticationMiddleware, customerController.listCustomers);
router.get('/sizes', authenticationMiddleware, customerController.listEnabledSizes);
router.get('/sold-to', authenticationMiddleware, customerController.searchSoldToCustomers);
router.get('/tax-no-exists', authenticationMiddleware, customerController.customerTaxNoExists);
router.post('/', authenticationMiddleware, customerController.createCustomer);
router.get('/:id/customer-logs', authenticationMiddleware, customerLogController.listCustomerLogs);
router.get('/:id/customer-logs/:logId', authenticationMiddleware, customerLogController.getCustomerLog);
router.get('/:id', authenticationMiddleware, customerController.getCustomer);
router.patch('/:id', authenticationMiddleware, customerController.updateCustomer);
router.delete('/:id', authenticationMiddleware, customerController.deleteCustomer);

module.exports = router;
