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
    // Email links always act on behalf of the approver who received the email, even if forwarded.
    const approverActor = {
      email: data.approverEmail,
      displayName: data.approverName,
      profile: {
        CODE: data.approverId,
        EFFECTIVE_CODE: data.approverId,
        EMAIL: data.approverEmail,
        LOGGED_IN_EMAIL: data.approverEmail,
        FULL_NAME: data.approverName,
      },
    };
    const notification = await notifyBestEffort({
      event: data.action === 'approve' && data.isFinalApproval ? 'final' : data.action,
      requestId: data.requestId,
      environment: process.env.NODE_ENV,
      actorEmail: data.approverEmail,
      actorName: data.approverName || 'Email action user',
      user: approverActor,
      auditActorCode: data.approverId,
      deliveryEmail: req.user ? (req.user.profile?.LOGGED_IN_EMAIL || req.user.email) : undefined,
      requireDeliveryEmail: true,
    });
    res.status(200).json({
      success: true,
      data: {
        ...data,
        notificationFailed: Boolean(notification?.failed),
        notificationSkipped: Boolean(notification?.skipped),
        notificationSkippedReason: notification?.reason,
      },
      correlationId: res.locals.correlationId || 'N/A',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getAction, confirmAction };
