/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));

const { getModels } = require('../models');
const { buildDescription, parseDescription, sanitizeValue, createEmailLog, updateEmailLog, listEmailLogs, toEmailSummary } = require('../services/emailLogService');

describe('emailLogService', () => {
  test.each([0, null, undefined])('labels automatic reminders without an employee actor (updated by %s)', (UPDATED_BY) => {
    const record = {
      UPDATED_BY,
      DESCRIPTION: buildDescription({ status: 'SENT', reminderContext: { automatic: true } }),
    };
    expect(toEmailSummary(record).actor).toBe('System (Auto Reminder)');
  });

  test('keeps the employee name when a user resends an automatic reminder', () => {
    const record = {
      UPDATED_BY: 123,
      updatedByEmployee: { INITIALS: 'AB', USERNAME: 'User' },
      DESCRIPTION: buildDescription({ status: 'SENT', reminderContext: { automatic: true } }),
    };
    expect(toEmailSummary(record).actor).toBe('AB-User');
  });

  test('does not mislabel a user resend with an unresolved employee as automatic', () => {
    expect(toEmailSummary({
      UPDATED_BY: 123,
      DESCRIPTION: buildDescription({ status: 'SENT', reminderContext: { automatic: true } }),
    }).actor).toBeNull();
  });

  test.each([{}, { reminderContext: { automatic: false } }])('keeps the missing actor for non-automatic emails', (payload) => {
    expect(toEmailSummary({ UPDATED_BY: 0, DESCRIPTION: JSON.stringify(payload) }).actor).toBeNull();
  });

  test.each([
    { reminderContext: { automatic: true } },
    { displayPayload: { reminderContext: { automatic: true } } },
  ])('recognizes legacy automatic reminder metadata', (payload) => {
    expect(toEmailSummary({ UPDATED_BY: 0, DESCRIPTION: JSON.stringify(payload) }).actor).toBe('System (Auto Reminder)');
  });

  beforeEach(() => {
    getModels.mockReset();
  });

  test('uses the scheduler transaction for both email log writes', async () => {
    const transaction = { id: 'reminder-transaction' };
    const emailLog = { update: jest.fn() };
    const Email = {
      sequelize: { literal: (value) => value },
      create: jest.fn().mockResolvedValue(emailLog),
    };
    getModels.mockReturnValue({ Email });
    await createEmailLog({ status: 'PENDING', subject: 'Reminder', transaction });
    await updateEmailLog(emailLog, { status: 'SENT', subject: 'Reminder', transaction });
    expect(Email.create).toHaveBeenCalledWith(expect.anything(), { transaction });
    expect(emailLog.update).toHaveBeenCalledWith(expect.anything(), { transaction });
  });

  test.each([
    ['PENDING', '69bd78f0-a012-4d47-bfed-4c0abd316877'],
    ['SENT', '23556cea-337f-475c-9b6a-830bfa08ab93'],
    ['FAILED', '2d8e6e9d-0b7b-427f-a5ba-0e65f61d945b'],
  ])('creates a %s email log with its matching log type', async (status, logTypeId) => {
    const Email = {
      sequelize: { literal: jest.fn((value) => value) },
      create: jest.fn().mockResolvedValue({}),
    };
    getModels.mockReturnValue({ Email });

    await createEmailLog({ status, subject: 'Subject' });

    expect(Email.create).toHaveBeenCalledWith(expect.objectContaining({ LOG_TYPE_ID: logTypeId }));
  });

  test('records the effective user as creator and the supplied audit actor as updater', async () => {
    const Email = {
      sequelize: { literal: jest.fn((value) => value) },
      create: jest.fn().mockResolvedValue({}),
    };
    getModels.mockReturnValue({ Email });

    await createEmailLog({
      status: 'PENDING',
      subject: 'Subject',
      user: { profile: { CODE: '20261631', EFFECTIVE_CODE: '20261631', LOGGED_IN_CODE: '20221459' } },
      auditActorCode: 20221459,
    });

    expect(Email.create).toHaveBeenCalledWith(expect.objectContaining({
      CREATED_BY: 20261631,
      UPDATED_BY: 20221459,
    }));
  });

  test.each([
    ['PENDING', '69bd78f0-a012-4d47-bfed-4c0abd316877'],
    ['SENT', '23556cea-337f-475c-9b6a-830bfa08ab93'],
    ['FAILED', '2d8e6e9d-0b7b-427f-a5ba-0e65f61d945b'],
  ])('updates a %s email log with its matching log type', async (status, logTypeId) => {
    const Email = { sequelize: { literal: jest.fn((value) => value) } };
    const emailLog = { update: jest.fn().mockResolvedValue(undefined) };
    getModels.mockReturnValue({ Email });

    await updateEmailLog(emailLog, { status, subject: 'Subject' });

    expect(emailLog.update).toHaveBeenCalledWith(expect.objectContaining({ LOG_TYPE_ID: logTypeId }));
  });

  test('keeps raw Base64 in send parameters but shortens only display payload', () => {
    const base64 = 'A'.repeat(1024);
    const description = buildDescription({
      status: 'PENDING',
      environment: 'dev',
      template: 'request-completed',
      subject: '[DEV e-Credit] - Subject',
      baseSubject: 'Subject',
      recipients: { to: ['person@example.com'], cc: [] },
      bcc: ['audit@example.com'],
      model: { attachment: base64 },
    });

    const payload = parseDescription(description);
    expect(payload.sendParameters.model.attachment).toBe(base64);
    expect(payload.displayPayload.model.attachment).toContain('base64 omitted');
    expect(payload.sendParameters.recipients).toEqual({ to: ['person@example.com'], cc: [] });
  });

  test('redacts sensitive fields only in the display payload', () => {
    const description = buildDescription({
      status: 'SENT',
      environment: 'prd',
      template: 'request-completed',
      subject: 'Subject',
      recipients: { to: ['person@example.com'], cc: [] },
      bcc: ['audit@example.com'],
      model: { apiToken: 'secret-value', companyName: 'Current value' },
    });

    const payload = parseDescription(description);
    expect(payload.sendParameters.model.apiToken).toBe('secret-value');
    expect(payload.displayPayload.model.apiToken).toBe('[omitted]');
    expect(payload.displayPayload.model.companyName).toBe('Current value');
  });

  test('sanitizes nested values without changing the original object', () => {
    const model = { body: { content: 'B'.repeat(600) } };
    const sanitized = sanitizeValue(model);
    expect(sanitized.body.content).toContain('base64 omitted');
    expect(model.body.content).toHaveLength(600);
  });

  test('loads email logs and counts them without the employee join', async () => {
    const rows = [];
    const Email = {
      findAll: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(21),
    };
    const Employee = {};
    getModels.mockReturnValue({ Email, Employee });

    const result = await listEmailLogs('request-1', { page: '2', pageSize: '10' });

    expect(Email.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { REQUEST_ID: 'request-1', ENABLED: true },
      limit: 10,
      offset: 10,
      include: [{ model: Employee, as: 'updatedByEmployee', attributes: ['INITIALS', 'USERNAME'], required: false }],
    }));
    expect(Email.count).toHaveBeenCalledWith({ where: { REQUEST_ID: 'request-1', ENABLED: true } });
    expect(result).toEqual({
      items: [],
      pagination: { page: 2, pageSize: 10, totalItems: 21, totalPages: 3 },
    });
  });
});
