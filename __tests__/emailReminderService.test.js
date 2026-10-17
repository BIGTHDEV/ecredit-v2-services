/* eslint-env jest */
jest.mock('../config/env', () => ({
  environment: 'prd', jwt: { secret: 'reminder-test-secret' }, email: { bcc: 'audit@example.com' },
}));
jest.mock('../config/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../services/emailService', () => ({
  sendEmail: jest.fn(),
  resolveRecipients: jest.requireActual('../services/emailService').resolveRecipients,
}));
jest.mock('../services/requestEmailModelService', () => ({ getRequestEmailModel: jest.fn() }));
jest.mock('../services/requestService', () => ({ listApprovalHistory: jest.fn() }));
jest.mock('../services/requestWorkflowNotificationService', () => ({
  pendingApprovers: jest.fn((history) => history),
  approvalActionsFor: jest.fn(() => [{ url: 'fresh-approval-link' }]),
}));
jest.mock('../services/emailReminderConfigService', () => ({
  ...jest.requireActual('../services/emailReminderConfigService'),
  listSettings: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const config = require('../config/env');
const logger = require('../config/logger');
const { getModels } = require('../models');
const { getDatabase } = require('../config/database');
const { sendEmail } = require('../services/emailService');
const { getRequestEmailModel } = require('../services/requestEmailModelService');
const { listApprovalHistory } = require('../services/requestService');
const { listSettings } = require('../services/emailReminderConfigService');
const { buildDescription } = require('../services/emailLogService');
const {
  approvalIdFromLog, reminderKey, getEligibility, isDue, processReminder, runEmailReminders, startEmailReminderScheduler,
  previewReminderRequests,
} = require('../services/emailReminderService');

const DRAFT = 'db8b3768-8466-4974-8dff-4c374b16a639';
const WAITING = '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b';
const FINAL = '014e8e8b-42cf-4b2f-8cae-e395e26efbcd';
const APPROVED = 'aab5ce03-1c54-48c8-8305-6b1a017b43fd';
const BACKWARD = 'b76065cc-6507-458d-94ce-87231cbaa57c';
const date = (minutes) => new Date(Date.UTC(2026, 9, 16, 0, minutes));
let models;
let database;
let source;
let parameters;
let settings;

beforeEach(() => {
  jest.clearAllMocks();
  config.environment = 'prd';
  parameters = {
    environment: 'prd', template: 'request-final', baseSubject: 'Original subject',
    recipients: { to: ['original@example.com'], cc: ['copy@example.com'] },
    bcc: ['audit@example.com'], model: { dear: 'Original recipient' },
  };
  source = { ID: 'source', REQUEST_ID: 'request', CATEGORY: 'request-final', CREATED_DATE: date(1), UPDATED_DATE: date(1) };
  settings = { ID: 'config', TEMPLATE: 'request-final', INTERVAL_VALUE: 1, INTERVAL_UNIT: 'hours', ENABLED: true };
  models = {
    Request: { findOne: jest.fn().mockResolvedValue({ STATUS_ID: FINAL, UPDATED_DATE: date(30), SUBMITTED_DATE: date(-10) }) },
    Approval: { findAll: jest.fn().mockResolvedValue([{ ID: 'approval', APPROVAL_TYPE_ID: APPROVED, CREATED_DATE: date(-5), UPDATED_DATE: date(0), ENABLED: true }]) },
    EmailReminderConfig: { findOne: jest.fn().mockResolvedValue(settings) },
    EmailReminderState: {
      findByPk: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (values) => ({ ...values, update: jest.fn() })),
    },
    Email: { findAll: jest.fn().mockResolvedValue([]) },
  };
  database = {
    transaction: jest.fn(async (callback) => callback({ id: 'transaction' })),
    query: jest.fn(async (sql) => sql.includes('sp_getapplock') ? [{ RESULT: 0 }] : [{ NOW: date(60) }]),
  };
  getModels.mockReturnValue(models);
  getDatabase.mockReturnValue(database);
  getRequestEmailModel.mockResolvedValue({ companyName: 'Current company' });
  sendEmail.mockReset().mockResolvedValue({ messageId: 'message' });
  listApprovalHistory.mockResolvedValue([]);
  listSettings.mockResolvedValue([{ template: 'request-final', enabled: true }]);
});

describe('reminder eligibility and timing', () => {
  test('previews only due requests using the selected interval without sending email', async () => {
    source.DESCRIPTION = JSON.stringify({ sendParameters: parameters });
    models.Email.findAll.mockResolvedValue([source]);
    getRequestEmailModel.mockResolvedValue({
      requestNo: 'REQ-100',
      companyName: 'Example Company',
      link: 'https://example.com/all-requests/request?tab=approver',
    });

    const result = await previewReminderRequests('request-final', { intervalValue: 1, intervalUnit: 'hours' });

    expect(result).toEqual({
      requests: [{
        requestId: 'request',
        requestNo: 'REQ-100',
        companyName: 'Example Company',
        requestLink: 'https://example.com/all-requests/request?tab=approver',
        approverName: null,
      }],
      skippedCount: 0,
    });
    expect(models.EmailReminderState.findByPk).toHaveBeenCalledWith(reminderKey(source, 'request-final'));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(models.EmailReminderState.create).not.toHaveBeenCalled();
  });

  test('does not preview candidates before the selected interval is due', async () => {
    source.DESCRIPTION = JSON.stringify({ sendParameters: parameters });
    models.Email.findAll.mockResolvedValue([source]);
    database.query.mockImplementation(async () => [{ NOW: date(59) }]);

    const result = await previewReminderRequests('request-final', { intervalValue: 1, intervalUnit: 'hours' });

    expect(result.requests).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('validates template and interval when previewing', async () => {
    await expect(previewReminderRequests('unknown-template', { intervalValue: 1, intervalUnit: 'hours' }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(previewReminderRequests('request-final', { intervalValue: 0, intervalUnit: 'hours' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('final counts from the last approval, not request edits or email delivery', async () => {
    const eligibility = await getEligibility(source, 'request-final');
    expect(eligibility.anchor).toBe(date(0).getTime());
    expect(isDue(eligibility, null, settings, date(60))).toBe(true);
    expect(isDue(eligibility, null, settings, date(59))).toBe(false);
  });

  test('backward uses disabled approval history while draft eligibility follows current status and updated date', async () => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: DRAFT, SUBMITTED_DATE: date(-10), UPDATED_DATE: date(50) });
    models.Approval.findAll.mockResolvedValue([{ APPROVAL_TYPE_ID: BACKWARD, CREATED_DATE: date(-5), UPDATED_DATE: date(0), ENABLED: false }]);
    expect((await getEligibility(source, 'request-backward')).anchor).toBe(date(0).getTime());
    expect(await getEligibility(source, 'request-draft')).toEqual({ anchor: date(50).getTime() });
  });

  test('draft restarts from REQUESTS.UPDATED_DATE and needs no approval history', async () => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: DRAFT, UPDATED_DATE: date(30) });
    const eligibility = await getEligibility(source, 'request-draft');
    expect(isDue(eligibility, null, settings, date(89))).toBe(false);
    expect(isDue(eligibility, null, settings, date(90))).toBe(true);
    expect(models.Approval.findAll).not.toHaveBeenCalled();
  });

  test.each(['request-draft', 'request-backward', 'request-final', 'request-approval'])('stops %s after leaving the required status', async (template) => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: 'completed-or-cancelled' });
    expect(await getEligibility(source, template, 'approval')).toBeNull();
  });

  test('ignores deleted requests', async () => {
    models.Request.findOne.mockResolvedValue(null);
    expect(await getEligibility(source, 'request-final')).toBeNull();
  });

  test('a request currently in draft is eligible regardless of submission and backward history', async () => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: DRAFT, SUBMITTED_DATE: date(-2), UPDATED_DATE: date(10) });
    models.Approval.findAll.mockResolvedValue([{ APPROVAL_TYPE_ID: BACKWARD, CREATED_DATE: date(-5), UPDATED_DATE: date(-4) }]);
    expect((await getEligibility(source, 'request-draft')).anchor).toBe(date(10).getTime());
  });

  test.each(['request-backward', 'request-final'])('does not reuse an email from before the latest %s action', async (template) => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: template === 'request-final' ? FINAL : DRAFT });
    models.Approval.findAll.mockResolvedValue([{ APPROVAL_TYPE_ID: template === 'request-final' ? APPROVED : BACKWARD, CREATED_DATE: date(-5), UPDATED_DATE: date(10), ENABLED: true }]);
    expect(await getEligibility(source, template)).toBeNull();
  });

  test('approval only reminds its own currently pending approver, including parallel approvals', async () => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: WAITING });
    listApprovalHistory.mockResolvedValue([{ ID: 'approval', APPROVER_NAME: 'Pending approver' }]);
    const eligibility = await getEligibility(source, 'request-approval', 'approval');
    expect(eligibility.approver.ID).toBe('approval');
    listApprovalHistory.mockResolvedValue([{ ID: 'another-parallel-approval' }]);
    expect(await getEligibility(source, 'request-approval', 'approval')).toBeNull();
  });

  test('approval Save does not stop or reset the reminder timer', async () => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: WAITING, UPDATED_DATE: date(59) });
    models.Approval.findAll.mockResolvedValue([{ ID: 'approval', CREATED_DATE: date(0), UPDATED_DATE: date(59), ENABLED: true }]);
    listApprovalHistory.mockResolvedValue([{ ID: 'approval' }]);
    const eligibility = await getEligibility(source, 'request-approval', 'approval');
    expect(eligibility.anchor).toBe(date(1).getTime());
    expect(isDue(eligibility, null, settings, date(61))).toBe(true);
  });

  test('rejects missing dates instead of silently sending', async () => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: DRAFT, UPDATED_DATE: null });
    await expect(getEligibility(source, 'request-draft')).rejects.toThrow('date');
  });

  test('repeats indefinitely, waits exactly one interval after each send, and throttles failed attempts', () => {
    const eligibility = { anchor: date(0).getTime() };
    const state = { LAST_SENT_DATE: date(120), SENT_COUNT: 100000 };
    expect(isDue(eligibility, state, settings, date(179))).toBe(false);
    expect(isDue(eligibility, state, settings, date(180))).toBe(true);
    state.LAST_ATTEMPT_DATE = date(180);
    expect(isDue(eligibility, state, settings, date(239))).toBe(false);
    expect(isDue(eligibility, state, settings, date(240))).toBe(true);
  });
});

describe('approval identity', () => {
  test('retains new metadata in raw and visible logs', () => {
    const payload = JSON.parse(buildDescription({ status: 'SENT', reminderContext: { approvalId: 'approval' } }));
    expect(payload.sendParameters.reminderContext.approvalId).toBe('approval');
    expect(payload.displayPayload.reminderContext.approvalId).toBe('approval');
    expect(approvalIdFromLog(source, payload.sendParameters)).toBe('approval');
  });

  test('supports expired but valid signed links from historical logs', () => {
    const token = jwt.sign({ type: 'ecredit-email-approval', requestId: 'request', approvalId: 'approval' }, config.jwt.secret, { expiresIn: -1 });
    expect(approvalIdFromLog(source, { model: { approvalActions: [{ url: `https://example.com/email-approval/${token}` }] } })).toBe('approval');
  });

  test('rejects missing, forged, or cross-request approval links', () => {
    expect(() => approvalIdFromLog(source, {})).toThrow('no approval identity');
    const token = jwt.sign({ type: 'ecredit-email-approval', requestId: 'other', approvalId: 'approval' }, config.jwt.secret);
    expect(() => approvalIdFromLog(source, { model: { approvalActions: [{ url: `https://example.com/email-approval/${token}` }] } })).toThrow('invalid approval identity');
    const forged = jwt.sign({ type: 'ecredit-email-approval', requestId: 'request', approvalId: 'approval' }, 'wrong-secret');
    expect(() => approvalIdFromLog(source, { model: { approvalActions: [{ url: `https://example.com/email-approval/${forged}` }] } })).toThrow();
  });
});

describe('reminder delivery and durable state', () => {
  const process = () => processReminder(source, 'request-final', undefined, parameters, reminderKey(source, 'request-final'));

  test('uses the original To/CC/BCC, refreshed content, and records a linked reminder', async () => {
    await process();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipients: parameters.recipients, effectiveRecipients: parameters.recipients, effectiveBcc: parameters.bcc,
      subject: 'Original subject', model: { companyName: 'Current company' }, resendOf: 'source',
      reminderContext: expect.objectContaining({ automatic: true, sourceEmailId: 'source' }),
      transaction: { id: 'transaction' },
    }));
    const state = await models.EmailReminderState.create.mock.results[0].value;
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ SENT_COUNT: 1, LAST_ERROR: null, LAST_SENT_DATE: expect.anything() }), expect.anything());
    expect(database.query.mock.calls[0][0]).toContain("@LockOwner = 'Transaction'");
    expect(getRequestEmailModel).toHaveBeenCalledWith('request', 'Original recipient', { transaction: { id: 'transaction' } });
  });

  test('does not send before the configured threshold', async () => {
    database.query.mockImplementation(async (sql) => sql.includes('sp_getapplock') ? [{ RESULT: 0 }] : [{ NOW: date(59) }]);
    await process();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('writes SQL Server datetime columns using database time, not timezone-suffixed date strings', async () => {
    await process();
    const { Sequelize } = require('sequelize');
    const sequelize = new Sequelize({ dialect: 'mssql', logging: false });
    try {
      const State = require('../models/emailReminderState')(sequelize);
      const values = models.EmailReminderState.create.mock.calls[0][0];
      expect(values.CREATED_DATE.val).toBe('GETDATE()');
      expect(values.UPDATED_DATE.val).toBe('GETDATE()');
      const generator = sequelize.getQueryInterface().queryGenerator;
      const insert = generator.insertQuery(State.tableName, values, State.rawAttributes, {});
      expect(insert.query).toMatch(/GETDATE\(\),GETDATE\(\)/);
      expect(insert.bind.some((value) => typeof value === 'string' && /\d{2}:\d{2}.*[+-]\d{2}:\d{2}/.test(value))).toBe(false);

      const state = await models.EmailReminderState.create.mock.results[0].value;
      const updates = state.update.mock.calls[0][0];
      const update = generator.updateQuery(State.tableName, updates, { ID: values.ID }, {}, State.rawAttributes);
      for (const column of ['LAST_ATTEMPT_DATE', 'LAST_SENT_DATE', 'UPDATED_DATE']) {
        expect(update.query).toContain(`[${column}]=GETDATE()`);
      }
    } finally {
      await sequelize.close();
    }
  });

  test('a persisted send survives worker restarts without resetting the interval', async () => {
    models.EmailReminderState.findByPk.mockResolvedValue({ LAST_SENT_DATE: date(30), SENT_COUNT: 50 });
    await process();
    await process();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(models.EmailReminderState.create).not.toHaveBeenCalled();
  });

  test('does not overlap another worker or send after settings are disabled', async () => {
    database.query.mockResolvedValueOnce([{ RESULT: -1 }]);
    await process();
    expect(sendEmail).not.toHaveBeenCalled();
    models.EmailReminderConfig.findOne.mockResolvedValue(null);
    await process();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('surfaces lock errors', async () => {
    database.query.mockResolvedValueOnce([{ RESULT: -999 }]);
    await expect(process()).rejects.toThrow('lock');
  });

  test('persists failures and cooldown without increasing sent count', async () => {
    sendEmail.mockRejectedValue(new Error('SMTP unavailable'));
    await process();
    const state = await models.EmailReminderState.create.mock.results[0].value;
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ LAST_ERROR: 'SMTP unavailable', LAST_ATTEMPT_DATE: expect.anything() }), expect.anything());
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('SENT_COUNT');
    expect(logger.error).toHaveBeenCalled();
  });

  test.each(['dev', 'qas'])('uses only the original tester in %s and removes legacy CC/BCC', async (environment) => {
    config.environment = environment;
    parameters.recipients = { to: ['tester@example.com'], cc: [] };
    parameters.bcc = [];
    await process();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: 'tester@example.com', effectiveBcc: [] }));
    sendEmail.mockClear();
    parameters.recipients.cc = ['real-copy@example.com'];
    parameters.bcc = ['audit@example.com'];
    await process();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: 'tester@example.com',
      recipients: { to: ['tester@example.com'], cc: [] },
      effectiveRecipients: { to: ['tester@example.com'], cc: [] },
      effectiveBcc: [],
      user: { profile: { CODE: '0', LOGGED_IN_EMAIL: 'tester@example.com' } },
    }));
  });

  test.each(['dev', 'qas'])('never falls back to approver addresses when the original %s tester is missing or ambiguous', async (environment) => {
    config.environment = environment;
    for (const to of [[], ['first@example.com', 'second@example.com'], ['invalid-address']]) {
      parameters.recipients = { to, cc: ['real-approver@example.com'] };
      await process();
    }
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(3);
  });

  test('refreshes expiring approval action links for the same approver', async () => {
    models.Request.findOne.mockResolvedValue({ STATUS_ID: WAITING });
    listApprovalHistory.mockResolvedValue([{ ID: 'approval' }]);
    database.query.mockImplementation(async (sql) => sql.includes('sp_getapplock') ? [{ RESULT: 0 }] : [{ NOW: date(61) }]);
    await processReminder(source, 'request-approval', 'approval', parameters, 'key');
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({ approvalActions: [{ url: 'fresh-approval-link' }] }),
    }));
  });

  test('keeps only the latest original log per request/template and excludes other environments', async () => {
    source.DESCRIPTION = JSON.stringify({ sendParameters: parameters });
    models.Email.findAll.mockResolvedValue([source, { ...source, ID: 'older' }, {
      ...source, ID: 'other-environment', DESCRIPTION: JSON.stringify({ sendParameters: { ...parameters, environment: 'qas' } }),
    }]);
    await runEmailReminders();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const query = models.Email.findAll.mock.calls[0][0];
    expect(query.where[Op.and].val).toContain('$.resendOf');
  });

  test('disabled configurations and empty logs send nothing, without creating draft recipients', async () => {
    listSettings.mockResolvedValue([]);
    await runEmailReminders();
    expect(models.Email.findAll).not.toHaveBeenCalled();
    listSettings.mockResolvedValue([{ template: 'request-draft', enabled: true }]);
    await runEmailReminders();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('processes CRM Draft sources as request-draft when send parameters are present', async () => {
    source.CATEGORY = 'api.crm.email';
    source.DESCRIPTION = JSON.stringify({ template: 'request-draft', sendParameters: parameters });
    models.Request.findOne.mockResolvedValue({ STATUS_ID: DRAFT, UPDATED_DATE: date(0) });
    models.Email.findAll.mockResolvedValue([source]);
    listSettings.mockResolvedValue([{ template: 'request-draft', enabled: true }]);

    await runEmailReminders();

    expect(models.Email.findAll.mock.calls[0][0].where.CATEGORY[Op.in]).toContain('api.crm.email');
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ template: 'request-draft' }));
  });

  test('previews CRM Draft sources without sending and reports missing send parameters', async () => {
    source.CATEGORY = 'api.crm.email';
    source.DESCRIPTION = JSON.stringify({ template: 'request-draft', sendParameters: parameters });
    models.Request.findOne.mockResolvedValue({ STATUS_ID: DRAFT, UPDATED_DATE: date(0) });
    models.Email.findAll.mockResolvedValue([source]);

    const result = await previewReminderRequests('request-draft', { intervalValue: 1, intervalUnit: 'minutes' });
    expect(result.requests).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();

    source.DESCRIPTION = JSON.stringify({ template: 'request-draft', status: 'SENT' });
    expect(await previewReminderRequests('request-draft', { intervalValue: 1, intervalUnit: 'minutes' }))
      .toEqual({ requests: [], skippedCount: 1 });
    expect(logger.error).toHaveBeenCalledWith('Unable to preview email reminder candidate',
      expect.objectContaining({ message: 'Original email has no stored send parameters.' }));
  });

  test.each([
    ['dev', 'request-draft', 'dev', true],
    ['dev', 'request-draft', 'qas', false],
    ['qas', 'request-draft', 'dev', false],
    ['prd', 'request-draft', 'qas', false],
    ['dev', 'request-final', 'qas', false],
  ])('cross-environment %s %s from %s is allowed: %s for preview and delivery', async (environment, template, sourceEnvironment, allowed) => {
    config.environment = environment;
    parameters.environment = sourceEnvironment;
    parameters.template = template;
    source.CATEGORY = template === 'request-draft' ? 'api.crm.email' : template;
    source.DESCRIPTION = JSON.stringify({ template, sendParameters: parameters });
    settings.TEMPLATE = template;
    if (template === 'request-draft') {
      models.Request.findOne.mockResolvedValue({ STATUS_ID: DRAFT, UPDATED_DATE: date(0) });
    }
    models.Email.findAll.mockResolvedValue([source]);
    listSettings.mockResolvedValue([{ template, enabled: true }]);

    const result = await previewReminderRequests(template, { intervalValue: 1, intervalUnit: 'minutes' });
    expect(result.requests).toHaveLength(allowed ? 1 : 0);
    expect(sendEmail).not.toHaveBeenCalled();

    await runEmailReminders();
    expect(sendEmail).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (allowed) {
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
        effectiveRecipients: { to: ['original@example.com'], cc: [] },
        effectiveBcc: [],
      }));
    }
  });

  test('invalid historical logs are reported without stopping other eligible emails', async () => {
    source.DESCRIPTION = JSON.stringify({ sendParameters: parameters });
    models.Email.findAll.mockResolvedValue([{ ...source, ID: 'invalid', DESCRIPTION: '{}' }, source]);
    await runEmailReminders();
    expect(logger.error).toHaveBeenCalledWith('Unable to process email reminder', expect.objectContaining({ sourceEmailId: 'invalid' }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('paginates original logs without sending duplicate reminder groups', async () => {
    source.DESCRIPTION = JSON.stringify({ sendParameters: parameters });
    models.Email.findAll
      .mockResolvedValueOnce(Array.from({ length: 200 }, (_, index) => ({ ...source, ID: `source-${index}` })))
      .mockResolvedValueOnce([{ ...source, REQUEST_ID: 'second-request' }]);
    await runEmailReminders();
    expect(models.Email.findAll.mock.calls[1][0].offset).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  test('generates the active-request filter using the SQL Server email model alias', async () => {
    const { Sequelize } = require('sequelize');
    const sequelize = new Sequelize({ dialect: 'mssql', logging: false });
    sequelize.query = jest.fn().mockResolvedValue([]);
    models.Email = require('../models/email')(sequelize);
    await runEmailReminders();
    const sql = sequelize.query.mock.calls[0][0];
    expect(sql).toContain('[EMAIL_LOGS] AS [Email]');
    expect(sql).toContain('CONVERT(VARCHAR(128), [Email].[REQUEST_ID])');
    expect(sql).toContain('REMINDER_REQUEST.ENABLED = 1');
    expect(sql).toContain('$.resendOf');
    expect(sql).toContain("[Email].[CATEGORY] <> 'api.crm.email'");
    expect(sql).toContain("'$.template')");
    expect(sql).toContain("DRAFT_FOLLOWUP.CATEGORY = 'api.crm.email'");
    expect(sql).toContain('DRAFT_FOLLOWUP.CATEGORY IN (\'request-draft\', \'request-draft.hbs\')');
    expect(sql).toContain('$.sendParameters.reminderContext.automatic');
    expect(sql).toContain('$.displayPayload.reminderContext.automatic');
    await sequelize.close();
  });
});

describe('scheduler lifecycle', () => {
  afterEach(() => jest.useRealTimers());

  test('polls without overlapping, survives errors, and stops gracefully', async () => {
    jest.useFakeTimers();
    listSettings.mockRejectedValueOnce(new Error('Missing migration'));
    const stop = startEmailReminderScheduler();
    await jest.advanceTimersByTimeAsync(60000);
    expect(logger.error).toHaveBeenCalledWith('Email reminder scheduler failed', expect.anything());
    await jest.advanceTimersByTimeAsync(60000);
    expect(listSettings).toHaveBeenCalledTimes(2);
    await stop();
    await jest.advanceTimersByTimeAsync(120000);
    expect(listSettings).toHaveBeenCalledTimes(2);
  });

  test('does not start a second pass while the first pass is running and drains on stop', async () => {
    jest.useFakeTimers();
    let finish;
    listSettings.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const stop = startEmailReminderScheduler();
    await jest.advanceTimersByTimeAsync(240000);
    expect(listSettings).toHaveBeenCalledTimes(1);
    const stopping = stop();
    finish([]);
    await stopping;
    await jest.advanceTimersByTimeAsync(120000);
    expect(listSettings).toHaveBeenCalledTimes(1);
  });
});
