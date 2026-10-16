const path = require('path');
const config = require('../config/env');
const { getEmailTransporter, templatesDirectory } = require('../config/email');
const { isModelsInitialized } = require('../models');
const { createEmailLog, updateEmailLog } = require('./emailLogService');

const SUPPORTED_ENVIRONMENTS = new Set(['dev', 'qas', 'prd']);
const MODEL_KEYS = [
  'dear',
  'link',
  'linkRequestNo',
  'requestNo',
  'linkCrmNo',
  'crmNo',
  'requestType',
  'companyName',
  'soldToNo',
  'salesGroup',
  'businessType',
  'customerType',
  'companyRegisterDate',
  'registeredCapital',
  'companySize',
  'creditRatingScore',
  'creditRatingExisting',
  'creditRatingRequested',
  'creditRatingProposed',
  'profitability',
  'growth',
  'liquidity',
  'leverage',
  'existingProfitability',
  'existingGrowth',
  'existingLiquidity',
  'existingLeverage',
  'scoringNotes',
  'scoringClassificationNa',
  'scoringClassificationGovernment',
  'scoringClassificationOthers',
  'showScoringClassification',
  'clearOutstandingBalance',
  'withinApprovedLimit',
  'bankGuarantee',
  'cashDeposit',
  'showAdditionalConditions',
  'amountBank',
  'amountDeposit',
  'opinion',
  'creditTermExisting',
  'creditTermRequested',
  'creditTermProposed',
  'creditLimitExisting',
  'creditLimitRequested',
  'creditLimitProposed',
  'creditDetailsMovements',
  'creditDetailsSummary',
  'suggestedCreditDetails',
  'currentStep',
  'lastActionedStep',
  'cancelledNotes',
  'rejectedNotes',
];

function missingValue(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function normalizeValue(value) {
  if (missingValue(value)) return '-';
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeValue(child)]));
  }
  return value;
}

function normalizeEmailList(value, fieldName) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = values
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  if (normalized.some((item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))) {
    throw new Error(`${fieldName} contains an invalid email address.`);
  }
  return normalized;
}

function normalizeModel(model = {}) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new TypeError('EmailModel must be an object.');
  }

  const normalized = normalizeValue(model);
  MODEL_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) normalized[key] = '-';
  });
  return normalized;
}

function subjectPrefix(environment) {
  return {
    dev: '[DEV e-Credit]',
    qas: '[QAS e-Credit]',
    prd: '[e-Credit]',
  }[environment];
}

function resolveRecipients(environment, recipients = {}, actorEmail) {
  if (environment === 'dev' || environment === 'qas') {
    const recipientsForEnvironment = normalizeEmailList(actorEmail, 'actorEmail');
    if (recipientsForEnvironment.length !== 1) throw new Error(`A single actorEmail is required for ${environment.toUpperCase()} email.`);
    return { to: recipientsForEnvironment, cc: [] };
  }

  const to = normalizeEmailList(recipients.to, 'to');
  if (!to.length) throw new Error('to is required for PRD email.');
  return { to, cc: normalizeEmailList(recipients.cc, 'cc') };
}

function resolveTemplate(template) {
  if (typeof template !== 'string' || !/^[a-z0-9][a-z0-9_-]*(?:\.hbs)?$/i.test(template)) {
    throw new Error('template must be a simple Handlebars template filename.');
  }
  const templateName = template.replace(/\.hbs$/i, '');
  const templatePath = path.resolve(templatesDirectory, `${templateName}.hbs`);
  if (path.dirname(templatePath) !== templatesDirectory) throw new Error('template is outside the templates directory.');
  return templateName;
}

function createEmailService({ environment = config.environment, bcc = config.email.bcc, transporter } = {}) {
  async function sendEmail({ template, subject, model, recipients, actorEmail, requestId, user, resendOf, effectiveRecipients, effectiveBcc, intendedRecipients, auditActorCode, reminderContext, transaction }) {
    const normalizedEnvironment = String(environment).toLowerCase();
    if (!SUPPORTED_ENVIRONMENTS.has(normalizedEnvironment)) throw new Error('Unsupported email environment.');
    if (missingValue(subject)) throw new Error('subject is required.');

    const resolvedTemplate = resolveTemplate(template);
    const resolveActorEmail = normalizedEnvironment === 'prd' ? actorEmail
      : (user ? (user.profile?.LOGGED_IN_EMAIL || user.email) : actorEmail);
    const resolvedRecipients = normalizedEnvironment === 'prd'
      ? (effectiveRecipients || resolveRecipients(normalizedEnvironment, recipients, resolveActorEmail))
      : resolveRecipients(normalizedEnvironment, recipients, resolveActorEmail);
    const bccRecipients = normalizedEnvironment === 'prd' ? (effectiveBcc || normalizeEmailList(bcc, 'bcc')) : [];
    if (normalizedEnvironment === 'prd' && !bccRecipients.length) throw new Error('EMAIL_BCC is required.');

    const isReminder = reminderContext?.automatic === true;
    const normalizedModel = { ...normalizeModel(model), isReminder };
    const emailSubject = `${isReminder ? 'Reminder!! ' : ''}${subjectPrefix(normalizedEnvironment)} - ${String(subject).trim()}`;
    const emailPayload = { requestId, user, auditActorCode, environment: normalizedEnvironment, template: resolvedTemplate, baseSubject: String(subject).trim(), subject: emailSubject, model: normalizedModel, recipients: resolvedRecipients, bcc: bccRecipients, resendOf, reminderContext, transaction };
    const debugRecipients = intendedRecipients || recipients || resolvedRecipients;
    const templateDebugRecipients = {
      to: normalizeEmailList(debugRecipients.to, 'intendedRecipients.to'),
      cc: normalizeEmailList(debugRecipients.cc, 'intendedRecipients.cc'),
    };
    const templateContext = normalizedEnvironment === 'prd' ? normalizedModel : {
      ...normalizedModel,
      showEmailDebugInfo: true,
      emailDebugInfo: {
        subject: emailSubject,
        to: templateDebugRecipients.to,
        cc: templateDebugRecipients.cc,
      },
    };
    let emailLog = null;
    if (requestId && isModelsInitialized()) emailLog = await createEmailLog({ ...emailPayload, status: 'PENDING' });
    try {
      const mailTransporter = transporter || await getEmailTransporter();
      const result = await mailTransporter.sendMail({ from: config.email.from, to: resolvedRecipients.to, cc: resolvedRecipients.cc, bcc: bccRecipients, subject: emailPayload.subject, template: resolvedTemplate, context: templateContext });
      if (emailLog) await updateEmailLog(emailLog, { ...emailPayload, status: 'SENT', providerResult: result });
      return result;
    } catch (error) {
      if (emailLog) await updateEmailLog(emailLog, { ...emailPayload, status: 'FAILED', error });
      throw error;
    }
  }

  return { sendEmail };
}

const defaultEmailService = createEmailService();

module.exports = {
  MODEL_KEYS,
  normalizeModel,
  resolveRecipients,
  subjectPrefix,
  createEmailService,
  sendEmail: defaultEmailService.sendEmail,
};
