/* eslint-env jest */

jest.mock('../config/env', () => ({
  corsAllowedOrigins: ['https://admin.example.com'],
  frontendBaseUrl: 'https://ecredit-qas.bigth.com/email-approval',
}));
jest.mock('../config/logger', () => ({ warn: jest.fn() }));

const express = require('express');
const request = require('supertest');
const corsMiddleware = require('../middlewares/cors');
const logger = require('../config/logger');

function createApp() {
  const app = express();
  app.use(corsMiddleware());
  app.get('/', (req, res) => res.sendStatus(200));
  app.use((error, req, res, _next) => {
    res.status(403).json({ message: error.message });
  });
  return app;
}

describe('CORS middleware', () => {
  it('allows the origin configured by FRONTEND_BASE_URL', async () => {
    const response = await request(createApp())
      .get('/')
      .set('Origin', 'https://ecredit-qas.bigth.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://ecredit-qas.bigth.com');
  });

  it('allows explicitly configured origins', async () => {
    const response = await request(createApp())
      .get('/')
      .set('Origin', 'https://admin.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://admin.example.com');
  });

  it('rejects origins outside the configured frontend and allowlist', async () => {
    const response = await request(createApp())
      .get('/')
      .set('Origin', 'https://untrusted.example.com');

    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'CORS rejected request from origin: https://untrusted.example.com',
      expect.objectContaining({ origin: 'https://untrusted.example.com' }),
    );
  });
});
