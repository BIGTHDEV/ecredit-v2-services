/* eslint-env jest */

jest.mock('../config/env', () => ({
  environment: 'dev',
  email: { from: 'from@example.com', bcc: 'audit@example.com' },
}));
jest.mock('../config/email', () => ({
  templatesDirectory: require('path').resolve(__dirname, '../templates'),
  getEmailTransporter: jest.fn(),
}));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));

const { getDatabase } = require('../config/database');
const { createEmailService, normalizeModel, subjectPrefix } = require('../services/emailService');

const model = { companyName: 'Acme', customerType: '' };

function createTransporter() {
  return { sendMail: jest.fn().mockResolvedValue({ messageId: 'message-1' }) };
}

describe('emailService', () => {
  describe('request-draft recipients', () => {
    let query;
    const transaction = { id: 'draft-transaction' };

    beforeEach(() => {
      query = jest.fn()
        .mockResolvedValueOnce([{ INITIALS: 'CREDIT1/CREDIT2', CURRENT_EMAIL: 'credit1@example.com; credit2@example.com;' }])
        .mockResolvedValueOnce([{ INITIALS: 'REQUESTER', CURRENT_EMAIL: 'requester@example.com' }]);
      getDatabase.mockReturnValue({ query });
    });

    test.each([
      ['dev', 'normal'], ['qas', 'normal'], ['prd', 'normal'],
      ['dev', 'resend'], ['qas', 'resend'], ['prd', 'resend'],
      ['dev', 'reminder'], ['qas', 'reminder'], ['prd', 'reminder'],
    ])('uses current team/requester recipients for %s %s delivery and debug details', async (environment, mode) => {
      const transporter = createTransporter();
      const isProduction = environment === 'prd';
      await createEmailService({ environment, transporter }).sendEmail({
        template: 'request-draft.hbs',
        subject: 'Draft request',
        model: { ...model, dear: 'Old recipient' },
        requestId: 'request-1',
        recipients: { to: ['old-team@example.com'], cc: ['old-requester@example.com'] },
        intendedRecipients: { to: ['wrong-debug@example.com'], cc: [] },
        effectiveRecipients: { to: ['old-tester@example.com'], cc: ['old-copy@example.com'] },
        effectiveBcc: mode === 'normal' ? undefined : ['stored-audit@example.com'],
        actorEmail: 'viewed@example.com',
        user: { profile: { LOGGED_IN_EMAIL: 'tester@example.com', EFFECTIVE_EMAIL: 'viewed@example.com' } },
        resendOf: mode === 'normal' ? undefined : 'source-email',
        reminderContext: mode === 'reminder' ? { automatic: true } : undefined,
        transaction,
      });

      expect(query).toHaveBeenNthCalledWith(1, expect.stringMatching(/TB1\.USER_ID = TB2\.EMP_CODE/), {
        replacements: { roleId: 'fd08992c-08cc-4c39-8f0d-dfcc0cb90663' }, type: 'SELECT', transaction,
      });
      expect(query.mock.calls[0][0]).toContain('STRING_AGG(LOWER(TB2.CURRENT_EMAIL)');
      expect(query.mock.calls[0][0]).toContain("TB1.ENABLED = '1'");
      expect(query).toHaveBeenNthCalledWith(2, expect.stringMatching(/TB1\.REQUESTED_BY = TB2\.EMP_CODE/), {
        replacements: { requestId: 'request-1' }, type: 'SELECT', transaction,
      });
      expect(query.mock.calls[1][0]).toContain("TB1.ENABLED = '1'");
      const sent = transporter.sendMail.mock.calls[0][0];
      expect(sent.to).toEqual(isProduction ? ['credit1@example.com', 'credit2@example.com'] : ['tester@example.com']);
      expect(sent.cc).toEqual(isProduction ? ['requester@example.com'] : []);
      expect(sent.bcc).toEqual(isProduction ? [mode === 'normal' ? 'audit@example.com' : 'stored-audit@example.com'] : []);
      expect(sent.context.dear).toBe('Credit Team');
      expect(sent.context.isReminder).toBe(mode === 'reminder');
      if (isProduction) {
        expect(sent.context).not.toHaveProperty('emailDebugInfo');
      } else {
        expect(sent.context.emailDebugInfo).toMatchObject({
          to: ['credit1@example.com', 'credit2@example.com'],
          cc: ['requester@example.com'],
        });
        const fs = require('fs');
        const path = require('path');
        const handlebars = require('handlebars');
        const html = handlebars.compile(fs.readFileSync(path.join(__dirname, '..', 'templates', 'request-draft.hbs'), 'utf8'))(sent.context);
        expect(html).toContain('Dear Credit Team,');
        expect(html).toContain('Show for testing only.');
        expect(html).toMatch(/<strong>To:<\/strong>[\s\S]*credit1@example\.com[\s\S]*credit2@example\.com/);
        expect(html).toMatch(/<strong>CC:<\/strong>\s*requester@example\.com/);
        expect(html).not.toContain('old-team@example.com');
      }
    });

    test.each([
      [[], [{ CURRENT_EMAIL: 'requester@example.com' }], 'Credit Team'],
      [[{ CURRENT_EMAIL: null }], [{ CURRENT_EMAIL: 'requester@example.com' }], 'Credit Team'],
      [[{ CURRENT_EMAIL: 'credit@example.com;' }], [], 'requester'],
      [[{ CURRENT_EMAIL: 'credit@example.com;' }], [{ CURRENT_EMAIL: null }], 'requester'],
      [[{ CURRENT_EMAIL: 'invalid;' }], [{ CURRENT_EMAIL: 'requester@example.com' }], 'invalid email'],
    ])('rejects missing or invalid draft recipients without sending (%s, %s)', async (team, requester, error) => {
      query.mockReset().mockResolvedValueOnce(team).mockResolvedValueOnce(requester);
      const transporter = createTransporter();
      await expect(createEmailService({ environment: 'dev', transporter }).sendEmail({
        template: 'request-draft', subject: 'Draft', model, requestId: 'request-1', actorEmail: 'tester@example.com',
      })).rejects.toThrow(error);
      expect(transporter.sendMail).not.toHaveBeenCalled();
    });

    test('requires the request identity and propagates database failures', async () => {
      const transporter = createTransporter();
      const service = createEmailService({ environment: 'prd', transporter });
      const payload = { template: 'request-draft', subject: 'Draft', model };
      await expect(service.sendEmail(payload)).rejects.toThrow('requestId is required');
      expect(query).not.toHaveBeenCalled();
      query.mockReset().mockRejectedValue(new Error('Database unavailable'));
      await expect(service.sendEmail({ ...payload, requestId: 'request-1' })).rejects.toThrow('Database unavailable');
      expect(transporter.sendMail).not.toHaveBeenCalled();
    });
  });

  test.each([
    ['dev', 'Reminder!! [DEV e-Credit] - Subject'],
    ['qas', 'Reminder!! [QAS e-Credit] - Subject'],
    ['prd', 'Reminder!! [e-Credit] - Subject'],
  ])('marks only reminder subjects and template context in %s', async (environment, subject) => {
    const transporter = createTransporter();
    await createEmailService({ environment, transporter }).sendEmail({
      template: 'request-approval', subject: 'Subject', model,
      actorEmail: 'tester@example.com',
      recipients: { to: ['recipient@example.com'] },
      reminderContext: { automatic: true, sourceEmailId: 'source' },
    });
    const sent = transporter.sendMail.mock.calls[0][0];
    expect(sent.subject).toBe(subject);
    expect(sent.context.isReminder).toBe(true);
    if (environment !== 'prd') expect(sent.context.emailDebugInfo.subject).toBe(subject);
  });

  test.each([undefined, { approvalId: 'approval' }, { automatic: false }])('does not mark normal emails or manual resends as reminders: %j', async (reminderContext) => {
    const transporter = createTransporter();
    await createEmailService({ environment: 'dev', transporter }).sendEmail({
      template: 'request-approval', subject: 'Subject', model: { ...model, isReminder: true },
      actorEmail: 'tester@example.com', resendOf: 'source', reminderContext,
    });
    const sent = transporter.sendMail.mock.calls[0][0];
    expect(sent.subject).toBe('[DEV e-Credit] - Subject');
    expect(sent.context.isReminder).toBe(false);
  });

  test.each([
    ['dev', '[DEV e-Credit] - Subject'],
    ['qas', '[QAS e-Credit] - Subject'],
    ['prd', '[e-Credit] - Subject'],
  ])('builds the %s subject prefix', async (environment, subject) => {
    const transporter = createTransporter();
    await createEmailService({ environment, transporter }).sendEmail({
      template: 'request-completed',
      subject: 'Subject',
      model,
      actorEmail: environment === 'prd' ? undefined : 'actor@example.com',
      recipients: environment === 'prd' ? { to: ['recipient@example.com'], cc: ['copy@example.com'] } : undefined,
    });

    expect(transporter.sendMail.mock.calls[0][0]).toEqual(expect.objectContaining({
      subject,
      to: environment === 'prd' ? ['recipient@example.com'] : ['actor@example.com'],
      cc: environment === 'prd' ? ['copy@example.com'] : [],
      bcc: environment === 'prd' ? ['audit@example.com'] : [],
      template: 'request-completed',
    }));
    if (environment !== 'prd') {
      expect(transporter.sendMail.mock.calls[0][0].context.showEmailDebugInfo).toBe(true);
    } else {
      expect(transporter.sendMail.mock.calls[0][0].context).not.toHaveProperty('showEmailDebugInfo');
    }
  });

  test('adds resolved test recipient details to DEV template context', async () => {
    const transporter = createTransporter();
    await createEmailService({ environment: 'dev', transporter }).sendEmail({
      template: 'request-completed',
      subject: 'Subject',
      model,
      actorEmail: 'actor@example.com',
    });

    expect(transporter.sendMail.mock.calls[0][0].context).toEqual(expect.objectContaining({
      showEmailDebugInfo: true,
      emailDebugInfo: {
        subject: '[DEV e-Credit] - Subject',
        to: ['actor@example.com'],
        cc: [],
      },
    }));
  });

  test('shows intended recipients in DEV debug context without changing delivery', async () => {
    const transporter = createTransporter();
    await createEmailService({ environment: 'dev', transporter }).sendEmail({
      template: 'request-completed',
      subject: 'Workflow',
      model,
      recipients: { to: ['approver@example.com'], cc: ['manager@example.com'] },
      intendedRecipients: { to: ['approver@example.com'], cc: ['manager@example.com'] },
      actorEmail: 'actor@example.com',
    });

    expect(transporter.sendMail.mock.calls[0][0]).toEqual(expect.objectContaining({
      to: ['actor@example.com'],
      cc: [],
      context: expect.objectContaining({
        emailDebugInfo: {
          subject: '[DEV e-Credit] - Workflow',
          to: ['approver@example.com'],
          cc: ['manager@example.com'],
        },
      }),
    }));
  });

  test.each(['dev', 'qas'])('sends only to Main User in %s even when resend recipients are supplied', async (environment) => {
    const transporter = createTransporter();
    await createEmailService({ environment, transporter }).sendEmail({
      template: 'request-completed',
      subject: 'Workflow',
      model,
      recipients: { to: ['actual-recipient@example.com'], cc: ['copy@example.com'] },
      effectiveRecipients: { to: ['previous-main@example.com'], cc: ['previous-copy@example.com'] },
      effectiveBcc: ['previous-audit@example.com'],
      actorEmail: 'token-main@example.com',
      user: {
        profile: {
          LOGGED_IN_EMAIL: 'main@example.com',
          EFFECTIVE_EMAIL: 'viewed@example.com',
        },
      },
    });

    expect(transporter.sendMail.mock.calls[0][0]).toEqual(expect.objectContaining({
      to: ['main@example.com'],
      cc: [],
      bcc: [],
    }));
  });

  test('does not add test recipient details to PRD template context', async () => {
    const transporter = createTransporter();
    await createEmailService({ environment: 'prd', transporter }).sendEmail({
      template: 'request-completed',
      subject: 'Subject',
      model,
      recipients: { to: ['recipient@example.com'], cc: ['copy@example.com'] },
    });

    expect(transporter.sendMail.mock.calls[0][0].context).not.toEqual(expect.objectContaining({
      showEmailDebugInfo: true,
      emailDebugInfo: expect.anything(),
    }));
  });

  test.each(['dev', 'qas'])('prefers the authenticated token email over a viewed actor in %s', async (environment) => {
    const transporter = createTransporter();
    await createEmailService({ environment, transporter }).sendEmail({
      template: 'request-completed', subject: 'Subject', model,
      user: { email: 'logged-in@example.com', profile: { EMAIL: 'viewed@example.com' } },
      actorEmail: 'viewed@example.com',
    });
    expect(transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: ['logged-in@example.com'], cc: [], bcc: [],
    }));
  });

  test.each(['dev', 'qas'])('rejects multiple test recipients in %s', async (environment) => {
    const transporter = createTransporter();
    await expect(createEmailService({ environment, transporter }).sendEmail({
      template: 'request-completed', subject: 'Subject', model,
      actorEmail: 'tester@example.com,other@example.com',
    })).rejects.toThrow('single actorEmail');
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  test('normalizes omitted fields to dash', async () => {
    const transporter = createTransporter();
    await createEmailService({ environment: 'dev', transporter }).sendEmail({
      template: 'request-completed.hbs',
      subject: 'Subject',
      model: {},
      actorEmail: 'actor@example.com',
    });

    expect(transporter.sendMail.mock.calls[0][0].context).toEqual(expect.objectContaining({
      companyName: '-',
      customerType: '-',
      creditLimitProposed: '-',
      showScoringClassification: '-',
      showAdditionalConditions: '-',
    }));
  });

  test.each(['dev', 'qas'])('rejects %s without a session email instead of using EMAIL_BCC', async (environment) => {
    const transporter = createTransporter();
    await expect(createEmailService({ environment, transporter }).sendEmail({
      template: 'request-completed.hbs',
      subject: 'Subject',
      model,
    })).rejects.toThrow('actorEmail is required');

    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  test('rejects a template outside the allowed .hbs filename format', async () => {
    await expect(createEmailService({ environment: 'prd', transporter: createTransporter() }).sendEmail({
      template: '../secret.hbs',
      subject: 'Subject',
      model,
      recipients: { to: ['recipient@example.com'] },
    })).rejects.toThrow('simple Handlebars template filename');
  });

  test('rejects PRD without recipients', async () => {
    await expect(createEmailService({ environment: 'prd', transporter: createTransporter() }).sendEmail({
      template: 'request-completed.hbs',
      subject: 'Subject',
      model,
    })).rejects.toThrow('to is required');
  });

  test('exposes the expected prefixes and model normalization', () => {
    expect(subjectPrefix('dev')).toBe('[DEV e-Credit]');
    expect(normalizeModel({ opinion: null }).opinion).toBe('-');
  });

  test('normalizes the new approval summary fields recursively', () => {
    expect(normalizeModel({
      creditDetailsSummary: [{ step: 1, approver: null, status: 'Pending' }],
      suggestedCreditDetails: { creditLimit: null },
      currentStep: { comment: null },
    })).toEqual(expect.objectContaining({
      creditDetailsSummary: [{ step: 1, approver: '-', status: 'Pending' }],
      suggestedCreditDetails: { creditLimit: '-' },
      currentStep: { comment: '-' },
    }));
  });
});
