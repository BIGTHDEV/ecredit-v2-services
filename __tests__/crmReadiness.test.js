jest.mock('../config/env', () => ({ environment: 'dev' }));
jest.mock('../config/logger', () => ({ error: jest.fn() }));
jest.mock('../controllers/homeController', () => ({ getHealthStatus: jest.fn() }));
jest.mock('../middlewares/authentication', () => jest.fn((req, res, next) => {
  if (req.headers.authorization === 'Bearer valid-session') return next();
  return res.sendStatus(401);
}));
jest.mock('../services/salesforceStatusSyncService', () => ({ checkReadiness: jest.fn() }));
jest.mock('../services/eventLogService', () => ({ persistRequestEvent: jest.fn().mockResolvedValue() }));

const express = require('express');
const request = require('supertest');
const { checkReadiness } = require('../services/salesforceStatusSyncService');
const { persistRequestEvent } = require('../services/eventLogService');
const requestLogger = require('../middlewares/requestLogger');
const healthRoute = require('../routes/healthRoute');

describe('CRM readiness endpoint', () => {
  const app = express();
  app.use(requestLogger);
  app.use('/dev/api/health', healthRoute);

  beforeEach(() => jest.clearAllMocks());

  test.each([true, false])('returns readiness %s without HTTP request logs', async (ready) => {
    checkReadiness.mockResolvedValue({ ready });
    const response = await request(app).post('/dev/api/health/crm').set('Authorization', 'Bearer valid-session');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { ready } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(checkReadiness).toHaveBeenCalledTimes(1);
    expect(persistRequestEvent).not.toHaveBeenCalled();
  });

  test('requires a session before contacting Salesforce', async () => {
    await request(app).post('/dev/api/health/crm').expect(401);
    expect(checkReadiness).not.toHaveBeenCalled();
    expect(persistRequestEvent).not.toHaveBeenCalled();
  });

  test('preserves request logging for other endpoints', async () => {
    await request(app).post('/dev/api/health/other').expect(404);
    expect(persistRequestEvent).toHaveBeenCalledTimes(1);
  });
});