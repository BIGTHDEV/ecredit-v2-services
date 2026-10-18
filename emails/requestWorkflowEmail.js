const { createEmailService } = require('../services/emailService');

function sendRequestWorkflowEmail({
  environment,
  template,
  subject,
  emailModel,
  recipients,
  actorEmail,
  deliveryEmail,
  transporter,
  requestId,
  user,
  auditActorCode,
  reminderContext,
}) {
  return createEmailService({ environment, transporter }).sendEmail({
    template,
    subject,
    model: emailModel,
    recipients,
    intendedRecipients: recipients,
    actorEmail,
    deliveryEmail,
    requestId,
    user,
    auditActorCode,
    reminderContext,
  });
}

module.exports = { sendRequestWorkflowEmail };
