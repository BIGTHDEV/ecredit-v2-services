/* eslint-env jest */

const path = require('path');
const request = require('supertest');

jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../models', () => ({ resetModels: jest.fn(), isModelsInitialized: () => false }));
jest.mock('../services/maintenanceService', () => ({ getState: jest.fn().mockResolvedValue({ active: false }) }));
jest.mock('sequelize', () => ({
  ...jest.requireActual('sequelize'),
  Sequelize: jest.fn(() => ({ authenticate: jest.fn().mockResolvedValue(), close: jest.fn().mockResolvedValue() })),
}));
jest.mock('dotenv', () => ({ config: jest.fn() }));

const originalEnv = process.env;

afterEach(() => { process.env = originalEnv; });

test.each(['dev', 'qas', 'prd'])('%s selects its env file, database and shared routes', async (environment) => {
  jest.resetModules();
  process.env = { NODE_ENV: environment };
  const dotenv = require('dotenv');
  dotenv.config.mockImplementation(({ path: envPath }) => {
    const selected = path.basename(envPath).replace('.env.', '');
    Object.assign(process.env, {
      PORT: '3035',
      DB_SERVER: `sql-${selected}.example.com`, DB_INSTANCE_NAME: selected, DB_PORT: '1433',
      DB_USER: `user-${selected}`, DB_PASSWORD: `test-${selected}`, DB_NAME: `ecredit-${selected}`,
      DB_ENCRYPT: 'true', DB_TRUST_SERVER_CERTIFICATE: 'false', DB_POOL_MIN: '1', DB_POOL_MAX: '5',
      JWT_SECRET: 'test-secret-only', JWT_EXPIRES_IN: '1h',
      APP_BASE_URL: 'https://api.example.com', FRONTEND_BASE_URL: 'https://app.example.com',
      SALESFORCE_BASE_URL: 'https://crm.example.com', CORS_ALLOWED_ORIGINS: 'https://app.example.com',
      LOG_LEVEL: 'error', LOG_FORMAT: 'json', EMAIL_SMTP_HOST: 'smtp.example.com', EMAIL_SMTP_PORT: '587',
      EMAIL_SMTP_USER: 'sender@example.com', EMAIL_SMTP_PASSWORD: 'test-only',
      EMAIL_FROM: 'sender@example.com', EMAIL_BCC: 'audit@example.com',
      ATTACHMENT_STORAGE_DIRECTORY: 'test-storage', ATTACHMENT_PUBLIC_BASE_URL: 'https://files.example.com',
      ATTACHMENT_MAX_FILE_SIZE: '1000', DEFAULT_ATTACHMENT_TYPE_ID: '11111111-1111-4111-8111-111111111111',
      KEY_PATH: 'test.key', CERT_PATH: 'test.crt', CA_PATH: 'test-ca.crt',
      MSAL_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
      MSAL_TENANT_ID: '11111111-1111-4111-8111-111111111111',
      MSAL_API_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
      MSAL_AUTHORITY: 'https://login.example.com', MSAL_EXPECTED_AUDIENCE: 'test-api',
      MSAL_EXPECTED_ISSUER: 'https://login.example.com', MSAL_API_SCOPE: 'test-scope',
      MSAL_GRAPH_ENDPOINT: 'https://graph.example.com',
      SWAGGER_TITLE: 'Test API', SWAGGER_DESCRIPTION: 'Test API', SWAGGER_VERSION: '1.0.0',
    });
    return {};
  });

  const config = require('../config/env');
  const database = require('../config/database');
  const { Sequelize } = require('sequelize');
  expect(require('../package.json').scripts[`start:${environment}`]).toContain(`NODE_ENV=${environment}`);
  expect(dotenv.config).toHaveBeenCalledWith({ path: path.resolve(__dirname, `../.env.${environment}`) });
  expect(config.environment).toBe(environment);
  await database.initializeDatabase();
  expect(Sequelize).toHaveBeenCalledWith(expect.objectContaining({
    host: `sql-${environment}.example.com`, username: `user-${environment}`,
    password: `test-${environment}`, database: `ecredit-${environment}`, port: 1433,
    dialectOptions: { options: { instanceName: environment, encrypt: true, trustServerCertificate: false } },
  }));
  await database.closeDatabase();

  const express = require('express');
  const app = express();
  app.use(require('../routes'));
  const home = await request(app).get(`/${environment}/api/home`).expect(200);
  expect(home.body.data.environment).toBe(environment);
  await request(app).get(`/${environment}/api/health/live`).expect(200);
  const docs = await request(app).get(`/${environment}/api/docs/openapi.json`).expect(200);
  expect(docs.body.servers[0].url).toBe(`https://api.example.com/${environment}/api`);
  const swaggerUi = await request(app).get(`/${environment}/api/docs/swagger-ui-init.js`).expect(200);
  expect(swaggerUi.text).toContain(`/${environment}/api/docs/openapi.json`);
  for (const other of ['dev', 'qas', 'prd'].filter((item) => item !== environment)) {
    await request(app).get(`/${other}/api/home`).expect(404);
  }
  const requests = require('../routes/requestRoute');
  expect(requests.stack.some((layer) => layer.route?.path === '/simulate-crm-request')).toBe(environment !== 'prd');
});
