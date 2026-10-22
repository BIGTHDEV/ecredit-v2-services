/* eslint-env jest */
jest.mock('../services/maintenanceService', () => ({ getState: jest.fn().mockResolvedValue({ active: false }) }));
jest.mock('../config/env', () => ({
  environment: 'dev',
  email: { from: 'sender@example.com', bcc: 'default-audit@example.com' },
  jwt: { secret: 'reminder-delivery-test-secret' },
}));
jest.mock('../config/email', () => ({
  templatesDirectory: require('path').resolve(__dirname, '../templates'),
  getEmailTransporter: jest.fn(),
}));
jest.mock('../config/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../models', () => ({ getModels: jest.fn(), isModelsInitialized: () => true }));
jest.mock('../services/emailService', () => {
  const service = jest.requireActual('../services/emailService');
  return { ...service, sendEmail: (payload) => service.createEmailService().sendEmail(payload) };
});
jest.mock('../services/requestEmailModelService', () => ({ getRequestEmailModel: jest.fn() }));
jest.mock('../services/requestService', () => ({ listApprovalHistory: jest.fn() }));
jest.mock('../services/requestWorkflowNotificationService', () => ({
  pendingApprovers: (history) => history,
  approvalActionsFor: () => [{ url: 'https://example.com/fresh-approval-link' }],
}));

const config = require('../config/env');
const { getEmailTransporter } = require('../config/email');
const { getDatabase } = require('../config/database');
const { getModels } = require('../models');
const { getRequestEmailModel } = require('../services/requestEmailModelService');
const { listApprovalHistory } = require('../services/requestService');
const { processReminder } = require('../services/emailReminderService');

describe('reminder delivery through the real email service and request Email Logs', () => {
  let models;
  let transporter;
  let parameters;
  let source;
  let emailLog;
  const date = (minutes) => new Date(Date.UTC(2026, 9, 16, 0, minutes));
  const transaction = { id: 'reminder-transaction' };

  beforeEach(() => {
    jest.clearAllMocks();
    transporter = { sendMail: jest.fn().mockResolvedValue({ messageId: 'reminder-message', accepted: ['tester@example.com'], rejected: [] }) };
    getEmailTransporter.mockResolvedValue(transporter);
    emailLog = { update: jest.fn() };
    models = {
      Request: { findOne: jest.fn().mockResolvedValue({ STATUS_ID: '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b' }) },
      Approval: { findAll: jest.fn().mockResolvedValue([{ ID: 'approval', CREATED_DATE: date(-1), ENABLED: true }]) },
      EmailReminderConfig: { findOne: jest.fn().mockResolvedValue({ ID: 'config', INTERVAL_VALUE: 1, INTERVAL_UNIT: 'minutes', ENABLED: true }) },
      EmailReminderState: {
        findByPk: jest.fn().mockResolvedValue(null),
        create: jest.fn(async (values) => ({ ...values, update: jest.fn() })),
      },
      Email: { create: jest.fn().mockResolvedValue(emailLog), sequelize: { literal: (value) => value } },
    };
    getModels.mockReturnValue(models);
    getDatabase.mockReturnValue({
      transaction: async (callback) => callback(transaction),
      query: jest.fn(async (sql) => sql.includes('sp_getapplock') ? [{ RESULT: 0 }] : [{ NOW: date(60) }]),
    });
    listApprovalHistory.mockResolvedValue([{ ID: 'approval', APPROVER_EMAIL: 'real-approver@example.com' }]);
    getRequestEmailModel.mockResolvedValue({ dear: 'Tester', companyName: 'Current request' });
    source = { ID: 'original-email', REQUEST_ID: 'original-request', CREATED_DATE: date(0), UPDATED_DATE: date(0) };
    parameters = {
      baseSubject: 'Original approval subject',
      recipients: { to: ['tester@example.com'], cc: [] },
      bcc: [], model: { dear: 'Tester' },
    };
  });

  test.each([
    ['dev', false], ['dev', true], ['qas', false], ['qas', true], ['prd', false],
  ])('delivers %s reminders and logs SENT under the same request (legacy CC/BCC: %s)', async (environment, legacyCopies) => {
    config.environment = environment;
    if (legacyCopies || environment === 'prd') {
      parameters.recipients.cc = ['real-copy@example.com'];
      parameters.bcc = ['stored-audit@example.com'];
    }
    if (environment === 'prd') parameters.recipients.to = ['real-approver@example.com'];

    await processReminder(source, 'request-approval', 'approval', parameters, 'state');

    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: `Reminder!! ${environment === 'prd' ? '[e-Credit]' : environment === 'qas' ? '[QAS e-Credit]' : '[DEV e-Credit]'} - Original approval subject`,
      context: expect.objectContaining({ isReminder: true }),
      to: environment === 'prd' ? ['real-approver@example.com'] : ['tester@example.com'],
      cc: environment === 'prd' ? ['real-copy@example.com'] : [],
      bcc: ['default-audit@example.com'],
    }));
    expect(models.Email.create).toHaveBeenCalledWith(expect.objectContaining({
      REQUEST_ID: 'original-request', CATEGORY: 'request-approval', CREATED_BY: 0, UPDATED_BY: 0,
    }), { transaction });
    const pending = JSON.parse(models.Email.create.mock.calls[0][0].DESCRIPTION);
    expect(pending.status).toBe('PENDING');
    expect(pending.resendOf).toBe('original-email');
    expect(pending.sendParameters.recipients).toEqual({
      to: environment === 'prd' ? ['real-approver@example.com'] : ['tester@example.com'],
      cc: environment === 'prd' ? ['real-copy@example.com'] : [],
    });
    const sent = JSON.parse(emailLog.update.mock.calls[0][0].DESCRIPTION);
    expect(sent.status).toBe('SENT');
    expect(sent.sendParameters.baseSubject).toBe('Original approval subject');
    expect(sent.sendParameters.subject).toBe(transporter.sendMail.mock.calls[0][0].subject);
    expect(sent.sendParameters.model.isReminder).toBe(true);
    expect(sent.resendOf).toBe('original-email');
    expect(sent.sendParameters.reminderContext).toEqual({ automatic: true, sourceEmailId: 'original-email', approvalId: 'approval' });
    expect(sent.providerResult.messageId).toBe('reminder-message');
    expect(emailLog.update.mock.calls[0][1]).toEqual({ transaction });
    const state = await models.EmailReminderState.create.mock.results[0].value;
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ SENT_COUNT: 1, LAST_ERROR: null }), { transaction });
  });

  test('records SMTP failures in the same request Email Logs without increasing sent count', async () => {
    config.environment = 'dev';
    transporter.sendMail.mockRejectedValue(new Error('SMTP unavailable'));
    await processReminder(source, 'request-approval', 'approval', parameters, 'state');
    expect(models.Email.create.mock.calls[0][0].REQUEST_ID).toBe('original-request');
    const failed = JSON.parse(emailLog.update.mock.calls[0][0].DESCRIPTION);
    expect(failed.status).toBe('FAILED');
    expect(failed.resendOf).toBe('original-email');
    expect(failed.error.message).toBe('SMTP unavailable');
    const state = await models.EmailReminderState.create.mock.results[0].value;
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('SENT_COUNT');
    expect(state.update.mock.calls[0][0].LAST_ERROR).toBe('SMTP unavailable');
  });

  test.each(['dev', 'qas', 'prd'])('refreshes draft recipients in %s reminders and persists the actual delivery', async (environment) => {
    config.environment = environment;
    models.Request.findOne.mockResolvedValue({
      STATUS_ID: 'db8b3768-8466-4974-8dff-4c374b16a639', UPDATED_DATE: date(0),
    });
    models.Approval.findAll.mockResolvedValue([]);
    getDatabase().query.mockImplementation(async (sql) => {
      if (sql.includes('sp_getapplock')) return [{ RESULT: 0 }];
      if (sql.includes('FROM USER_ROLES')) return [{ CURRENT_EMAIL: 'credit1@example.com; credit2@example.com;' }];
      if (sql.includes('FROM REQUESTS')) return [{ CURRENT_EMAIL: 'requester@example.com' }];
      return [{ NOW: date(60) }];
    });
    parameters.bcc = ['stored-audit@example.com'];

    await processReminder(source, 'request-draft', undefined, parameters, 'draft-state');

    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    const sent = transporter.sendMail.mock.calls[0][0];
    expect(sent).toMatchObject({
      to: environment === 'prd' ? ['credit1@example.com', 'credit2@example.com'] : ['tester@example.com'],
      cc: environment === 'prd' ? ['requester@example.com'] : [],
      bcc: ['default-audit@example.com'],
      context: { dear: 'Credit Team', isReminder: true },
    });
    if (environment !== 'prd') {
      expect(sent.context.emailDebugInfo).toMatchObject({
        to: ['credit1@example.com', 'credit2@example.com'], cc: ['requester@example.com'],
      });
    }
    const logged = JSON.parse(emailLog.update.mock.calls[0][0].DESCRIPTION);
    expect(logged.status).toBe('SENT');
    expect(logged.sendParameters.recipients).toEqual({ to: sent.to, cc: sent.cc });
    expect(logged.sendParameters.bcc).toEqual(sent.bcc);
    expect(logged.sendParameters.model.dear).toBe('Credit Team');
    expect(models.Email.create).toHaveBeenCalledWith(expect.objectContaining({
      REQUEST_ID: source.REQUEST_ID, CATEGORY: 'request-draft',
    }), { transaction });
    const recipientQueries = getDatabase().query.mock.calls.filter(([sql]) => /FROM (USER_ROLES|REQUESTS)/.test(sql));
    expect(recipientQueries).toHaveLength(2);
    recipientQueries.forEach(([, options]) => expect(options.transaction).toBe(transaction));
  });

  test.each(['dev', 'qas'])('does not send to a current real approver when the original %s tester is missing', async (environment) => {
    config.environment = environment;
    parameters.recipients.to = [];
    await processReminder(source, 'request-approval', 'approval', parameters, 'state');
    expect(transporter.sendMail).not.toHaveBeenCalled();
    const state = await models.EmailReminderState.create.mock.results[0].value;
    expect(state.update.mock.calls[0][0].LAST_ERROR).toContain('single actorEmail');
  });
});
