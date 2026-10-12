const express = require('express');
const authenticationMiddleware = require('../../middlewares/authentication');
const customerAccessMiddleware = require('../../middlewares/customerAccess');
const customerController = require('../../controllers/qas/customerController');
const customerLogController = require('../../controllers/customerLogController');

const router = express.Router();

router.use(authenticationMiddleware, customerAccessMiddleware);

router.get('/', customerController.listCustomers);
router.get('/sizes', customerController.listEnabledSizes);
router.get('/sold-to', customerController.searchSoldToCustomers);
router.get('/tax-no-exists', customerController.customerTaxNoExists);
router.post('/', customerController.createCustomer);
router.get('/:id/customer-logs', customerLogController.listCustomerLogs);
router.get('/:id/customer-logs/:logId', customerLogController.getCustomerLog);
router.get('/:id', customerController.getCustomer);
router.patch('/:id', customerController.updateCustomer);
router.delete('/:id', customerController.deleteCustomer);

module.exports = router;
