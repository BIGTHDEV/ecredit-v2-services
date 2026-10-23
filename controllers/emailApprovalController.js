const emailApprovalActionService = require('../services/emailApprovalActionService');
const { notifyBestEffort } = require('../services/requestWorkflowNotificationService');
const { syncRequestStatusSafely } = require('../services/salesforceStatusSyncService');

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
    const crmSync = data.action === 'reject'
      ? await syncRequestStatusSafely(data.requestId, '94589a22-12e5-4298-aa30-06295acbe1b9', {
        correlationId: res.locals.correlationId || 'N/A', actorCode: data.approverId,
      })
      : null;
    res.status(200).json({
      success: true,
      data: {
        ...data,
        notificationFailed: Boolean(notification?.failed),
        notificationSkipped: Boolean(notification?.skipped),
        notificationSkippedReason: notification?.reason,
      },
      crmSync,
      correlationId: res.locals.correlationId || 'N/A',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getAction, confirmAction };
