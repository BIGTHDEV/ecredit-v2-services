/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../services/emailLogService', () => ({
  findEmailLogs: jest.fn(),
  parseDescription: jest.fn(),
}));
jest.mock('../services/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../services/requestEmailModelService', () => ({ getRequestEmailModel: jest.fn() }));

const { getModels } = require('../models');
const emailLogService = require('../services/emailLogService');
const { sendEmail } = require('../services/emailService');
const { getRequestEmailModel } = require('../services/requestEmailModelService');
const { resendRequestEmails } = require('../controllers/emailController');

test('resend uses the active email service and current user, not the logged environment or recipient', async () => {
  getModels.mockReturnValue({ Request: { findOne: jest.fn().mockResolvedValue({ ID: 'request-1' }) } });
  emailLogService.findEmailLogs.mockResolvedValue([{ ID: 'email-1' }]);
  emailLogService.parseDescription.mockReturnValue({ sendParameters: {
    environment: 'prd',
    template: 'request-completed',
    baseSubject: 'Completed',
    recipients: { to: ['real@example.com'], cc: ['copy@example.com'] },
    bcc: ['audit@example.com'],
  } });
  getRequestEmailModel.mockResolvedValue({ companyName: 'Acme' });
  sendEmail.mockResolvedValue({ messageId: 'resent-1' });
  const user = { email: 'tester@example.com', profile: { LOGGED_IN_EMAIL: 'tester@example.com' } };
  const req = { params: { requestId: 'request-1' }, body: { emailIds: ['email-1'] }, user };
  const res = { locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();

  await resendRequestEmails(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: 'tester@example.com', user }));
  expect(sendEmail.mock.calls[0][0]).not.toHaveProperty('environment');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('resending a reminder preserves its presentation metadata and original base subject', async () => {
  getModels.mockReturnValue({ Request: { findOne: jest.fn().mockResolvedValue({ ID: 'request-1' }) } });
  emailLogService.findEmailLogs.mockResolvedValue([{ ID: 'reminder-1' }]);
  const reminderContext = { automatic: true, sourceEmailId: 'original-1', approvalId: 'approval-1' };
  emailLogService.parseDescription.mockReturnValue({ sendParameters: {
    template: 'request-approval', baseSubject: 'Approval',
    subject: 'Reminder!! [DEV e-Credit] - Approval', reminderContext,
    recipients: { to: ['tester@example.com'], cc: [] }, bcc: [],
  } });
  getRequestEmailModel.mockResolvedValue({ companyName: 'Current request' });
  sendEmail.mockResolvedValue({ messageId: 'resent-reminder' });
  const req = {
    params: { requestId: 'request-1' }, body: { emailIds: ['reminder-1'] },
    user: { email: 'tester@example.com' },
  };
  const res = { locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  await resendRequestEmails(req, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(sendEmail).toHaveBeenLastCalledWith(expect.objectContaining({
    subject: 'Approval', reminderContext, resendOf: 'reminder-1', requestId: 'request-1',
  }));
});
