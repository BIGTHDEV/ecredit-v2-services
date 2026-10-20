const path = require('path');
const nodemailer = require('nodemailer');
const config = require('./env');

const templatesDirectory = path.resolve(__dirname, '../templates');
let transporterPromise;

async function createEmailTransporter() {
  const { default: handlebarsAdapter } = await import('nodemailer-express-handlebars');
  const transporter = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    auth: {
      user: config.email.smtp.user,
      pass: config.email.smtp.password,
    },
  });

  transporter.use(
    'compile',
    handlebarsAdapter({
      viewEngine: {
        extname: '.hbs',
        layoutsDir: templatesDirectory,
        defaultLayout: false,
      },
      viewPath: templatesDirectory,
      extName: '.hbs',
    }),
  );

  return transporter;
}

function getEmailTransporter() {
  if (!transporterPromise) transporterPromise = createEmailTransporter();
  return transporterPromise;
}

function resetEmailTransporter() {
  transporterPromise = undefined;
}

module.exports = {
  templatesDirectory,
  createEmailTransporter,
  getEmailTransporter,
  resetEmailTransporter,
};
