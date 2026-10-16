const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config/env');
const authenticationMiddleware = require('../middlewares/authentication');
const requestController = require('../controllers/requestController');
const attachmentController = require('../controllers/attachmentController');
const eventLogController = require('../controllers/eventLogController');
const approvalHistoryController = require('../controllers/approvalHistoryController');
const requestMetadataController = require('../controllers/requestMetadataController');
const emailController = require('../controllers/emailController');
const crmSimulationController = require('../controllers/crmSimulationController');

const router = express.Router();

const companyInfoLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many company information searches. Please try again later.' },
  },
});

if (!config.isProduction()) {
  router.get('/simulate-crm-request/identifiers', authenticationMiddleware, crmSimulationController.getSimulationIdentifiers);
  router.post('/simulate-crm-request', authenticationMiddleware, crmSimulationController.simulateCrmRequest);
}
router.get('/', authenticationMiddleware, requestController.listRequests);
router.get('/statuses', authenticationMiddleware, requestMetadataController.listEnabledStatuses);
router.get('/log-types', authenticationMiddleware, requestMetadataController.listEnabledLogTypes);
router.get('/ratings', authenticationMiddleware, requestMetadataController.listEnabledRatings);
router.get('/terms', authenticationMiddleware, requestMetadataController.listTerms);
router.get('/event-logs', authenticationMiddleware, eventLogController.listAllEvents);
router.get('/event-logs/:logId', authenticationMiddleware, eventLogController.getAllEvent);
router.get('/:requestId/event-logs', authenticationMiddleware, eventLogController.listRequestEvents);
router.get('/:requestId/event-logs/:logId', authenticationMiddleware, eventLogController.getRequestEvent);
router.get('/:requestId/emails', authenticationMiddleware, emailController.listRequestEmails);
router.get('/:requestId/emails/:emailId', authenticationMiddleware, emailController.getRequestEmail);
router.post('/:requestId/emails/resend', authenticationMiddleware, emailController.resendRequestEmails);
router.get('/:requestId/approval-history', authenticationMiddleware, approvalHistoryController.listApprovalHistory);
router.get('/:requestId/approval-submit-options', authenticationMiddleware, approvalHistoryController.getApprovalSubmitOptions);
router.get('/:requestId/attachments', authenticationMiddleware, attachmentController.listAttachments);
router.post('/:requestId/attachments', authenticationMiddleware, attachmentController.uploadAttachments);
router.get('/:requestId/attachments/:attachmentId/download', authenticationMiddleware, attachmentController.downloadAttachment);
router.delete('/:requestId/attachments/:attachmentId', authenticationMiddleware, attachmentController.deleteAttachment);
router.get('/:id', authenticationMiddleware, requestController.getRequest);
router.post('/:id/customer-info-suggestions', authenticationMiddleware, companyInfoLookupLimiter, requestController.suggestRequestCustomerInfo);
router.post('/:id/test-email', authenticationMiddleware, requestController.sendTestEmail);
router.patch('/:id/customer-info', authenticationMiddleware, requestController.updateRequestCustomerInfo);
router.patch('/:id/credit-suggestion', authenticationMiddleware, requestController.updateRequestCreditSuggestion);
router.patch('/:id/scoring-payment', authenticationMiddleware, requestController.updateRequestScoringAndPayment);
router.patch('/:id/requested-details', authenticationMiddleware, requestController.updateRequestRequestedDetails);
router.patch('/:id/final-approval', authenticationMiddleware, requestController.saveFinalApproval);
router.post('/:id/clone-data', authenticationMiddleware, requestController.cloneRequestData);
router.patch('/:id/cancel', authenticationMiddleware, requestController.cancelRequest);
router.patch('/:id/status', authenticationMiddleware, approvalHistoryController.changeRequestStatus);
router.post('/:id/approval-action', authenticationMiddleware, approvalHistoryController.processApprovalAction);
router.post('/:id/submit', authenticationMiddleware, approvalHistoryController.submitRequest);

module.exports = router;
