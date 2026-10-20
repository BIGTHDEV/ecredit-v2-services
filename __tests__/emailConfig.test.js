/* eslint-env jest */

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ use: jest.fn() })),
}));
jest.mock('../config/env', () => ({
  email: { smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'sender@example.com', password: 'secret' } },
}));
jest.mock('nodemailer-express-handlebars', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const nodemailer = require('nodemailer');
const { createEmailTransporter } = require('../config/email');

describe('email transporter', () => {
  it('bounds SMTP connection, greeting, and socket waits', async () => {
    await createEmailTransporter();

    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    }));
  });
});