/* eslint-env jest */

jest.mock('../config/env', () => ({
  environment: 'dev',
  swagger: { version: 'test' },
}));
jest.mock('../config/logger', () => ({ error: jest.fn() }));
jest.mock('../middlewares/authentication', () => jest.fn());
jest.mock('../services/salesforceStatusSyncService', () => ({ checkReadiness: jest.fn() }));
jest.mock('../services/eventLogService', () => ({ persistRequestEvent: jest.fn().mockResolvedValue() }));

const express = require('express');
const request = require('supertest');
const { persistRequestEvent } = require('../services/eventLogService');
const requestLogger = require('../middlewares/requestLogger');
const healthRoute = require('../routes/healthRoute');

describe('Uptime Kuma health endpoint', () => {
  const app = express();
  app.use(requestLogger);
  app.use('/dev/api/health', healthRoute);

  beforeEach(() => jest.clearAllMocks());

  test('returns an uncached public liveness response', async () => {
    const response = await request(app).get('/dev/api/health/kuma');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('up');
    expect(Number.isNaN(Date.parse(response.body.data.timestamp))).toBe(false);
    expect(persistRequestEvent).not.toHaveBeenCalled();
  });
});
