/* eslint-env jest */
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../helpers/tokenValidator', () => ({ validateToken: jest.fn() }));
jest.mock('../services/userProfileService', () => ({ getUserProfileByEmail: jest.fn() }));
jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../controllers/emailApprovalController', () => ({
  getAction: jest.fn((_req, res) => res.json({ success: true })),
  confirmAction: jest.fn((_req, res) => res.json({ success: true })),
}));

const express = require('express');
const request = require('supertest');
const { getModels } = require('../models');
const { validateToken } = require('../helpers/tokenValidator');
const { getUserProfileByEmail } = require('../services/userProfileService');
const emailApprovalController = require('../controllers/emailApprovalController');
const authentication = require('../middlewares/authentication');
const gate = require('../middlewares/maintenance');
let app;
let row;

beforeEach(() => {
  jest.clearAllMocks();
  row = {
    ENABLED: true, MESSAGE: 'Upgrading', STARTS_AT: new Date(Date.now() - 60000),
    ENDS_AT: new Date(Date.now() + 60000),
  };
  row.update = jest.fn(async (values) => Object.assign(row, values));
  getModels.mockReturnValue({
    MaintenanceConfig: { findByPk: jest.fn().mockResolvedValue(row), sequelize: { literal: (v) => v } },
  });
  validateToken.mockImplementation((token) => ({
    valid: ['admin', 'super', 'user', 'viewed-admin'].includes(token),
    claims: { oid: 'oid', tid: 'tid', email: `${token}@example.com`, roles: ['System Admin'] },
  }));
  getUserProfileByEmail.mockImplementation(async (email) => ({
    LOGGED_IN_CODE: 123,
    LOGGED_IN_ROLE: email.startsWith('admin@') ? 'System Admin' : email.startsWith('super@') ? 'Super User' : 'User',
    ROLE: email.startsWith('viewed-admin@') ? 'System Admin' : 'User',
    IS_VIEWING_AS: true,
  }));
  app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.correlationId = 'test-correlation'; next(); });
  const api = express.Router();
  api.use(gate);
  api.use('/maintenance', require('../routes/maintenanceRoute'));
  api.use('/email-approval', require('../routes/emailApprovalRoute'));
  api.get('/requests', authentication, (_req, res) => res.json({ success: true }));
  api.post('/crm', (_req, res) => res.json({ success: true }));
  api.get('/health/live', (_req, res) => res.json({ success: true }));
  api.get('/auth/me', authentication, (_req, res) => res.json({ success: true }));
  api.get('/permissions/me', authentication, (_req, res) => res.json({ success: true }));
  api.get('/session/ping', authentication, (_req, res) => res.json({ success: true }));
  api.post('/session/presence', authentication, (_req, res) => res.json({ success: true }));
  api.options('/requests', (_req, res) => res.sendStatus(204));
  app.use('/dev/api', api);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
});

test('public status works without a token and is never cached', async () => {
  const response = await request(app).get('/dev/api/maintenance').expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    success: true,
    data: {
      enabled: true, active: true, message: 'Upgrading', startsAt: row.STARTS_AT.toISOString(),
      endsAt: row.ENDS_AT.toISOString(), serverTime: expect.any(String), canBypass: false,
    },
  });
  expect(getUserProfileByEmail).not.toHaveBeenCalled();
});

test.each(['super', 'user', 'viewed-admin', 'invalid'])('status does not allow bypass for %s', async (token) => {
  const response = await request(app).get('/dev/api/maintenance').set('Authorization', `Bearer ${token}`).expect(200);
  expect(response.body.data.canBypass).toBe(false);
});

test('status resolves actual System Admin even outside the maintenance window', async () => {
  row.ENABLED = false;
  const response = await request(app).get('/dev/api/maintenance').set('Authorization', 'Bearer admin').expect(200);
  expect(response.body.data).toMatchObject({ active: false, canBypass: true });
});

test.each(['super', 'user', 'viewed-admin', 'invalid', null])('blocks API use by %s with the frontend 503 contract', async (token) => {
  let call = request(app).get('/dev/api/requests');
  if (token) call = call.set('Authorization', `Bearer ${token}`);
  const response = await call.expect(503);
  expect(response.body).toEqual({
    success: false, error: { code: 'SYSTEM_MAINTENANCE', message: 'Upgrading' },
    data: expect.objectContaining({ active: true, canBypass: false }), correlationId: 'test-correlation',
  });
});

test('blocks public email approval display, confirm and CRM before any action runs', async () => {
  await request(app).get('/dev/api/email-approval/signed-admin-approval-token').expect(503);
  await request(app).post('/dev/api/email-approval/signed-admin-approval-token/confirm').expect(503);
  await request(app).post('/dev/api/crm').expect(503);
  expect(emailApprovalController.getAction).not.toHaveBeenCalled();
  expect(emailApprovalController.confirmAction).not.toHaveBeenCalled();
});

test('System Admin bypasses and reuses the already loaded authentication profile', async () => {
  await request(app).get('/dev/api/requests').set('Authorization', 'Bearer admin').expect(200);
  expect(validateToken).toHaveBeenCalledTimes(1);
  expect(getUserProfileByEmail).toHaveBeenCalledTimes(1);
});

test('non-System Admin cannot configure maintenance', async () => {
  await request(app).put('/dev/api/maintenance').set('Authorization', 'Bearer super').send({}).expect(403);
  await request(app).put('/dev/api/maintenance').expect(401);
  expect(row.update).not.toHaveBeenCalled();
});

test('actual System Admin configures and receives normalized state', async () => {
  const response = await request(app).put('/dev/api/maintenance').set('Authorization', 'Bearer admin')
    .send({ enabled: false, message: '', startsAt: null, endsAt: null }).expect(200);
  expect(response.body.data).toMatchObject({
    enabled: false, active: false, message: '', startsAt: null, endsAt: null, canBypass: true,
  });
});

test('health, preflight and exact authenticated bootstrap routes remain available', async () => {
  await request(app).get('/dev/api/health/live').expect(200);
  await request(app).options('/dev/api/requests').expect(204);
  for (const path of ['/auth/me', '/permissions/me', '/session/ping']) {
    await request(app).get(`/dev/api${path}`).set('Authorization', 'Bearer admin').expect(200);
  }
  await request(app).post('/dev/api/session/presence').set('Authorization', 'Bearer admin').expect(200);
  await request(app).put('/dev/api/permissions/me').set('Authorization', 'Bearer super').expect(503);
});

test('inactive maintenance preserves public approval behavior', async () => {
  row.ENABLED = false;
  await request(app).get('/dev/api/email-approval/token').expect(200);
  await request(app).post('/dev/api/email-approval/token/confirm').expect(200);
});

test('permission lookup errors propagate, rather than silently permitting or misidentifying callers', async () => {
  getUserProfileByEmail.mockRejectedValue(new Error('Database unavailable'));
  await request(app).get('/dev/api/maintenance').set('Authorization', 'Bearer admin').expect(500);
  await request(app).get('/dev/api/requests').set('Authorization', 'Bearer admin').expect(500);
});
