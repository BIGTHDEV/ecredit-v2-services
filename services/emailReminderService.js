const { createHash } = require('crypto');
const { Op, QueryTypes, literal } = require('sequelize');
const config = require('../config/env');
const logger = require('../config/logger');
const { getDatabase } = require('../config/database');
const { getModels } = require('../models');
const { parseDescription } = require('./emailLogService');
const { TEMPLATES, listSettings, intervalMilliseconds } = require('./emailReminderConfigService');
const { sendEmail, resolveRecipients } = require('./emailService');
const { getRequestEmailModel } = require('./requestEmailModelService');
const { listApprovalHistory } = require('./requestService');
const { pendingApprovers, approvalActionsFor } = require('./requestWorkflowNotificationService');
const { verifyEmailApprovalToken } = require('./emailApprovalActionService');
const maintenanceService = require('./maintenanceService');

const DRAFT_STATUS_ID = 'db8b3768-8466-4974-8dff-4c374b16a639';
const WAITING_STATUS_ID = '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b';
const FINAL_STATUS_ID = '014e8e8b-42cf-4b2f-8cae-e395e26efbcd';
const APPROVED_TYPE_ID = 'aab5ce03-1c54-48c8-8305-6b1a017b43fd';
const BACKWARD_TYPE_ID = 'b76065cc-6507-458d-94ce-87231cbaa57c';
const POLL_INTERVAL_MS = 60000;
const PAGE_SIZE = 200;

function timestamp(value) {
  const result = value == null ? NaN : new Date(value).getTime();
  if (!Number.isFinite(result)) throw new Error('Reminder source contains a missing or invalid date.');
  return result;
}

function approvalIdFromLog(source, parameters) {
  if (parameters.reminderContext?.approvalId) return parameters.reminderContext.approvalId;
  // Historical approval logs predate reminder metadata; their signed links still identify the approval.
  const link = parameters.model?.approvalActions?.[0]?.url;
  if (!link) throw new Error(`Approval email ${source.ID} has no approval identity; reminder was not sent.`);
  const token = decodeURIComponent(new URL(link).pathname.split('/').pop());
  const payload = verifyEmailApprovalToken(token, { ignoreExpiration: true });
  if (payload.type !== 'ecredit-email-approval' || String(payload.requestId) !== String(source.REQUEST_ID) || !payload.approvalId) {
    throw new Error(`Approval email ${source.ID} has an invalid approval identity.`);
  }
  return payload.approvalId;
}

function reminderKey(source, template, approvalId) {
  return createHash('sha256').update(JSON.stringify([
    config.environment, source.REQUEST_ID, template, approvalId || '',
  ])).digest('hex');
}

async function getEligibility(source, template, approvalId, transaction) {
  const { Request, Approval } = getModels();
  const request = await Request.findOne({ where: { ID: source.REQUEST_ID, ENABLED: true }, transaction });
  if (!request) return null;
  const expectedStatus = template === 'request-approval' ? WAITING_STATUS_ID
    : template === 'request-final' ? FINAL_STATUS_ID : DRAFT_STATUS_ID;
  if (String(request.STATUS_ID).toLowerCase() !== expectedStatus) return null;

  if (template === 'request-draft') return { anchor: timestamp(request.UPDATED_DATE) };

  const approvals = await Approval.findAll({ where: { REQUEST_ID: source.REQUEST_ID }, transaction });
  const cycle = approvals.filter((approval) => !request.SUBMITTED_DATE
    || timestamp(approval.CREATED_DATE) >= timestamp(request.SUBMITTED_DATE));
  const sentAt = timestamp(source.CREATED_DATE);
  if (template === 'request-approval') {
    const approval = cycle.find((item) => String(item.ID) === String(approvalId) && item.ENABLED);
    if (!approval || sentAt < timestamp(approval.CREATED_DATE)) return null;
    const history = await listApprovalHistory(source.REQUEST_ID, { transaction });
    const pending = pendingApprovers(history).find((item) => String(item.ID) === String(approvalId));
    return pending ? { anchor: timestamp(source.UPDATED_DATE), approver: pending } : null;
  }

  const backwards = cycle.filter((approval) => String(approval.APPROVAL_TYPE_ID).toLowerCase() === BACKWARD_TYPE_ID);
  const actioned = template === 'request-backward' ? backwards
    : cycle.filter((approval) => approval.ENABLED && String(approval.APPROVAL_TYPE_ID).toLowerCase() === APPROVED_TYPE_ID);
  if (!actioned.length) return null;
  const anchor = Math.max(...actioned.map((approval) => timestamp(approval.UPDATED_DATE)));
  if (sentAt < anchor) return null;
  return { anchor };
}

function isDue(eligibility, state, settings, now) {
  const baseline = Math.max(
    eligibility.anchor,
    state?.LAST_SENT_DATE ? timestamp(state.LAST_SENT_DATE) : 0,
    state?.LAST_ATTEMPT_DATE ? timestamp(state.LAST_ATTEMPT_DATE) : 0,
  );
  return timestamp(now) - baseline >= intervalMilliseconds(settings);
}

function findSourceEmails(Email, templates, offset) {
  const categories = templates.flatMap((template) => [template, `${template}.hbs`]);
  if (templates.includes('request-draft')) categories.push('api.crm.email');
  return Email.findAll({
    where: {
      ENABLED: true,
      CATEGORY: { [Op.in]: categories },
      [Op.and]: literal(`JSON_VALUE(CASE WHEN ISJSON([DESCRIPTION]) = 1 THEN [DESCRIPTION] ELSE '{}' END, '$.status') = 'SENT'
        AND JSON_VALUE(CASE WHEN ISJSON([DESCRIPTION]) = 1 THEN [DESCRIPTION] ELSE '{}' END, '$.resendOf') IS NULL
        AND (
          [Email].[CATEGORY] <> 'api.crm.email'
          OR JSON_VALUE(CASE WHEN ISJSON([DESCRIPTION]) = 1 THEN [DESCRIPTION] ELSE '{}' END, '$.template')
            IN ('request-draft', 'request-draft.hbs')
        )
        AND EXISTS (
          SELECT 1 FROM REQUESTS AS REMINDER_REQUEST
          WHERE CONVERT(VARCHAR(128), REMINDER_REQUEST.ID) COLLATE DATABASE_DEFAULT
            = CONVERT(VARCHAR(128), [Email].[REQUEST_ID]) COLLATE DATABASE_DEFAULT
            AND REMINDER_REQUEST.ENABLED = 1
            AND REMINDER_REQUEST.STATUS_ID IN ('${DRAFT_STATUS_ID}', '${WAITING_STATUS_ID}', '${FINAL_STATUS_ID}')
        )
        AND (
          [Email].[CATEGORY] NOT IN ('request-draft', 'request-draft.hbs', 'api.crm.email')
          OR NOT EXISTS (
            SELECT 1 FROM EMAIL_LOGS AS DRAFT_FOLLOWUP
            WHERE CONVERT(VARCHAR(128), DRAFT_FOLLOWUP.REQUEST_ID) COLLATE DATABASE_DEFAULT
              = CONVERT(VARCHAR(128), [Email].[REQUEST_ID]) COLLATE DATABASE_DEFAULT
              AND (
                DRAFT_FOLLOWUP.CATEGORY IN ('request-draft', 'request-draft.hbs')
                OR (
                  DRAFT_FOLLOWUP.CATEGORY = 'api.crm.email'
                  AND JSON_VALUE(CASE WHEN ISJSON(DRAFT_FOLLOWUP.DESCRIPTION) = 1 THEN DRAFT_FOLLOWUP.DESCRIPTION ELSE '{}' END, '$.template')
                    IN ('request-draft', 'request-draft.hbs')
                )
              )
              AND CONVERT(VARCHAR(128), DRAFT_FOLLOWUP.ID) COLLATE DATABASE_DEFAULT
                <> CONVERT(VARCHAR(128), [Email].[ID]) COLLATE DATABASE_DEFAULT
              AND COALESCE(
                JSON_VALUE(CASE WHEN ISJSON(DRAFT_FOLLOWUP.DESCRIPTION) = 1 THEN DRAFT_FOLLOWUP.DESCRIPTION ELSE '{}' END, '$.sendParameters.reminderContext.automatic'),
                JSON_VALUE(CASE WHEN ISJSON(DRAFT_FOLLOWUP.DESCRIPTION) = 1 THEN DRAFT_FOLLOWUP.DESCRIPTION ELSE '{}' END, '$.displayPayload.reminderContext.automatic'),
                'false'
              ) <> 'true'
          )
        )`),
    },
    order: [['CREATED_DATE', 'DESC'], ['ID', 'DESC']],
    limit: PAGE_SIZE,
    offset,
  });
}

async function previewReminderRequests(template, input) {
  if (!TEMPLATES.includes(template)) {
    const error = new Error('Unsupported reminder template.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const interval = {
    INTERVAL_VALUE: input?.intervalValue,
    INTERVAL_UNIT: input?.intervalUnit,
    ENABLED: true,
  };
  intervalMilliseconds(interval);

  const { Email, EmailReminderState } = getModels();
  const database = getDatabase();
  const [{ NOW: now }] = await database.query('SELECT GETDATE() AS NOW', { type: QueryTypes.SELECT });
  const requests = [];
  const seen = new Set();
  let skippedCount = 0;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const rows = await findSourceEmails(Email, [template], offset);
    for (const source of rows) {
      try {
        const parameters = parseDescription(source.DESCRIPTION).sendParameters;
        if (!parameters) throw new Error('Original email has no stored send parameters.');
        if (parameters.environment !== config.environment) continue;

        const approvalId = template === 'request-approval' ? approvalIdFromLog(source, parameters) : undefined;
        const key = reminderKey(source, template, approvalId);
        if (seen.has(key)) continue;
        seen.add(key);

        const eligibility = await getEligibility(source, template, approvalId);
        if (!eligibility) continue;
        const state = await EmailReminderState.findByPk(key);
        if (!isDue(eligibility, state, interval, now)) continue;

        const model = await getRequestEmailModel(source.REQUEST_ID, parameters.model?.dear || 'All');
        requests.push({
          requestId: source.REQUEST_ID,
          requestNo: model.requestNo,
          companyName: model.companyName,
          requestLink: model.link,
          approverName: eligibility.approver?.APPROVER_NAME || null,
        });
      } catch (error) {
        skippedCount += 1;
        logger.error('Unable to preview email reminder candidate', {
          sourceEmailId: source.ID,
          requestId: source.REQUEST_ID,
          template,
          message: error.message,
        });
      }
    }
    hasMore = rows.length === PAGE_SIZE;
    if (hasMore) offset += PAGE_SIZE;
  }

  return { requests, skippedCount };
}

async function processReminder(source, template, approvalId, parameters, key) {
  if ((await maintenanceService.getState()).active) return;
  const database = getDatabase();
  const { EmailReminderConfig, EmailReminderState } = getModels();
  return database.transaction(async (transaction) => {
    const [lock] = await database.query(
      `DECLARE @result INT;
       EXEC @result = sys.sp_getapplock @Resource = :resource, @LockMode = 'Exclusive',
         @LockOwner = 'Transaction', @LockTimeout = 0;
       SELECT @result AS RESULT;`,
      { replacements: { resource: `ecredit-email-reminder:${key}` }, type: QueryTypes.SELECT, transaction },
    );
    if (lock.RESULT === -1) return;
    if (lock.RESULT < 0) throw new Error(`Unable to acquire reminder lock: ${lock.RESULT}.`);

    const settings = await EmailReminderConfig.findOne({ where: { TEMPLATE: template, ENABLED: true }, transaction });
    if (!settings) return;
    const eligibility = await getEligibility(source, template, approvalId, transaction);
    if (!eligibility) return;
    let state = await EmailReminderState.findByPk(key, { transaction });
    const [{ NOW: now }] = await database.query('SELECT GETDATE() AS NOW', { type: QueryTypes.SELECT, transaction });
    if (!isDue(eligibility, state, settings, now)) return;

    if (!state) {
      const databaseNow = literal('GETDATE()');
      state = await EmailReminderState.create({
        ID: key, CONFIG_ID: settings.ID, SOURCE_EMAIL_ID: source.ID, REQUEST_ID: source.REQUEST_ID,
        SENT_COUNT: 0, CREATED_DATE: databaseNow, UPDATED_DATE: databaseNow, CREATED_BY: 0, UPDATED_BY: 0,
        ENABLED: true, SORTING: 0,
      }, { transaction });
    }

    let sendError = null;
    let sent = false;
    try {
      const isProduction = config.environment === 'prd';
      const recipients = resolveRecipients(config.environment, parameters.recipients, parameters.recipients?.to);
      const testerEmail = isProduction ? undefined : recipients.to[0];
      const model = await getRequestEmailModel(source.REQUEST_ID, parameters.model?.dear || 'All', { transaction });
      if (eligibility.approver) model.approvalActions = approvalActionsFor(source.REQUEST_ID, [eligibility.approver]);
      await sendEmail({
        template,
        subject: parameters.baseSubject,
        model,
        recipients,
        effectiveRecipients: recipients,
        effectiveBcc: isProduction ? parameters.bcc : [],
        actorEmail: testerEmail,
        requestId: source.REQUEST_ID,
        auditActorCode: 0,
        user: { profile: { CODE: '0', LOGGED_IN_EMAIL: testerEmail } },
        resendOf: source.ID,
        reminderContext: { sourceEmailId: source.ID, automatic: true, approvalId },
        transaction,
      });
      sent = true;
    } catch (error) {
      sendError = error;
      logger.error('Email reminder failed', { requestId: source.REQUEST_ID, sourceEmailId: source.ID, template, message: error.message });
    }
    const completedAt = literal('GETDATE()');
    await state.update({
      SOURCE_EMAIL_ID: source.ID,
      LAST_ATTEMPT_DATE: completedAt,
      ...(sent ? { LAST_SENT_DATE: completedAt, SENT_COUNT: state.SENT_COUNT + 1 } : {}),
      LAST_ERROR: sendError ? sendError.message.slice(0, 2048) : null,
      UPDATED_DATE: completedAt,
      UPDATED_BY: 0,
    }, { transaction });
    if (sent) logger.info('Email reminder sent', { requestId: source.REQUEST_ID, sourceEmailId: source.ID, template });
  });
}

async function runEmailReminders(shouldStop = () => false) {
  if ((await maintenanceService.getState()).active) return;
  const settings = (await listSettings()).filter((setting) => setting.enabled);
  if (!settings.length) return;
  const templates = settings.map((setting) => setting.template);
  const { Email } = getModels();
  const seen = new Set();
  let offset = 0;
  while (!shouldStop()) {
    const rows = await findSourceEmails(Email, templates, offset);
    for (const source of rows) {
      if (shouldStop()) return;
      try {
        const payload = parseDescription(source.DESCRIPTION);
        const parameters = payload.sendParameters;
        if (!parameters) throw new Error('Original email has no stored send parameters; reminder was not sent.');
        const template = (source.CATEGORY === 'api.crm.email' ? payload.template : source.CATEGORY).replace(/\.hbs$/i, '');
        if (parameters.environment !== config.environment) continue;
        const approvalId = template === 'request-approval' ? approvalIdFromLog(source, parameters) : undefined;
        const key = reminderKey(source, template, approvalId);
        if (seen.has(key)) continue;
        seen.add(key);
        await processReminder(source, template, approvalId, parameters, key);
      } catch (error) {
        logger.error('Unable to process email reminder', { sourceEmailId: source.ID, requestId: source.REQUEST_ID, message: error.message });
      }
    }
    if (rows.length < PAGE_SIZE) return;
    offset += PAGE_SIZE;
  }
}

function startEmailReminderScheduler() {
  let stopped = false;
  let timer;
  let running;
  const schedule = () => {
    timer = setTimeout(() => {
      running = runEmailReminders(() => stopped)
        .catch((error) => logger.error('Email reminder scheduler failed', { message: error.message }))
        .finally(() => { if (!stopped) schedule(); });
    }, POLL_INTERVAL_MS);
    timer.unref();
  };
  schedule();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

module.exports = {
  approvalIdFromLog,
  reminderKey,
  getEligibility,
  isDue,
  previewReminderRequests,
  processReminder,
  runEmailReminders,
  startEmailReminderScheduler,
};
