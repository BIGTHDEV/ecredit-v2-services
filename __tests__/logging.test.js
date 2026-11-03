/* eslint-env jest */

jest.mock('../config/env', () => ({
  environment: 'dev',
  logging: { level: 'debug', format: 'json' },
  isDevelopment: () => false,
}));
jest.mock('../models', () => ({ getModels: jest.fn(), isModelsInitialized: jest.fn(() => true) }));

const { getModels } = require('../models');
const logger = require('../config/logger');

describe('database diagnostic log filtering', () => {
  let Log;

  beforeEach(() => {
    jest.clearAllMocks();
    Log = { create: jest.fn().mockResolvedValue({}), sequelize: { literal: (value) => value } };
    getModels.mockReturnValue({ Log });
  });

  it.each([
    'Token validation successful',
    'Authentication successful for user user-id',
    'User profile returned for user-id',
    'Customers returned',
    'Customer returned',
    'Requests returned',
    'Request returned',
    'Permissions returned',
    'Session ping from user-id',
  ])('does not persist routine successful debug diagnostic: %s', async (message) => {
    await logger.persistLogEntry({ level: 'debug', message });
    expect(Log.create).not.toHaveBeenCalled();
  });

  it.each(['warn', 'error'])('preserves %s logs regardless of message text', async (level) => {
    await logger.persistLogEntry({ level, message: 'Token validation successful' });
    expect(Log.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['info', 'Database initialized successfully'],
    ['info', 'User permissions updated'],
    ['debug', 'Permissions updated'],
    ['debug', 'Customer soft deleted'],
    ['debug', 'Request cancelled'],
    ['debug', 'Unexpected diagnostic'],
  ])('preserves %s: %s', async (level, message) => {
    await logger.persistLogEntry({ level, message });
    expect(Log.create).toHaveBeenCalledWith(expect.objectContaining({ NAME: message }));
  });
});
