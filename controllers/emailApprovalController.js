const emailApprovalActionService = require('../services/emailApprovalActionService');
const { notifyBestEffort } = require('../services/requestWorkflowNotificationService');

async function getAction(req, res, next) {
  try {
    const data = await emailApprovalActionService.getEmailApprovalAction(req.params.token);
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) {
    next(error);
  }
}

async function confirmAction(req, res, next) {
  try {
    const data = await emailApprovalActionService.confirmEmailApprovalAction(req.params.token, req.body?.comment);
    const notification = await notifyBestEffort({
      event: data.action === 'approve' && data.isFinalApproval ? 'final' : data.action,
      requestId: data.requestId,
      environment: process.env.NODE_ENV,
      actorEmail: req.user?.email,
      actorName: req.user?.displayName || 'Email action user',
      user: req.user,
      auditActorCode: data.approverId,
    });
    res.status(200).json({
      success: true,
      data: {
        ...data,
        notificationFailed: Boolean(notification?.failed),
        notificationSkipped: Boolean(notification?.skipped),
      },
      correlationId: res.locals.correlationId || 'N/A',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getAction, confirmAction };
