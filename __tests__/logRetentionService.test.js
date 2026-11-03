/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/logger', () => ({ info: jest.fn(), error: jest.fn() }));

const { Op, Sequelize } = require('sequelize');
const { getModels } = require('../models');
const logger = require('../config/logger');
const { BATCH_SIZE, CHECK_INTERVAL_MS, purgeExpiredLogs, startLogRetentionScheduler } = require('../services/logRetentionService');

describe('LOGS retention', () => {
  let Log;

  beforeEach(() => {
    jest.clearAllMocks();
    Log = { destroy: jest.fn().mockResolvedValue(0), sequelize: { literal: Sequelize.literal } };
    getModels.mockReturnValue({ Log });
  });

  afterEach(() => jest.useRealTimers());

  it('physically deletes only rows strictly older than 90 days using database time and bounded batches', async () => {
    Log.destroy.mockResolvedValueOnce(BATCH_SIZE).mockResolvedValueOnce(12);

    await expect(purgeExpiredLogs()).resolves.toBe(BATCH_SIZE + 12);

    expect(Log.destroy).toHaveBeenCalledTimes(2);
    expect(Log.destroy).toHaveBeenCalledWith({
      where: { CREATED_DATE: { [Op.lt]: expect.objectContaining({ val: 'DATEADD(DAY, -90, GETDATE())' }) } },
      limit: 1000,
    });
  });

  it('generates a bounded SQL Server delete with the strict cutoff', async () => {
    await purgeExpiredLogs();
    const sequelize = new Sequelize('database', 'user', 'password', { dialect: 'mssql', logging: false });
    const sql = sequelize.getQueryInterface().queryGenerator.deleteQuery('LOGS', Log.destroy.mock.calls[0][0].where, { limit: BATCH_SIZE });
    expect(sql).toContain('DELETE TOP(1000) FROM [LOGS]');
    expect(sql).toContain('[CREATED_DATE] < DATEADD(DAY, -90, GETDATE())');
  });

  it('can stop between batches without starting another delete', async () => {
    let stopped = false;
    Log.destroy.mockImplementation(async () => { stopped = true; return BATCH_SIZE; });

    await expect(purgeExpiredLogs(() => stopped)).resolves.toBe(BATCH_SIZE);
    expect(Log.destroy).toHaveBeenCalledTimes(1);
  });

  it('runs after startup and hourly, and cancels future work on shutdown', async () => {
    jest.useFakeTimers();
    const stop = startLogRetentionScheduler();
    await jest.advanceTimersByTimeAsync(0);
    expect(Log.destroy).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(Log.destroy).toHaveBeenCalledTimes(2);
    await stop();
    await jest.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(Log.destroy).toHaveBeenCalledTimes(2);
  });

  it('does not overlap cleanup runs and waits for the current batch during shutdown', async () => {
    jest.useFakeTimers();
    let complete;
    Log.destroy.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const stop = startLogRetentionScheduler();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(Log.destroy).toHaveBeenCalledTimes(1);
    let finished = false;
    const stopping = stop().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    complete(BATCH_SIZE);
    await stopping;
    expect(finished).toBe(true);
    expect(Log.destroy).toHaveBeenCalledTimes(1);
  });

  it('logs a failed cleanup and retries on the next hourly run', async () => {
    jest.useFakeTimers();
    Log.destroy.mockRejectedValueOnce(new Error('Database unavailable'));
    const stop = startLogRetentionScheduler();
    await jest.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledWith('Log retention cleanup failed', { message: 'Database unavailable' });
    await jest.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(Log.destroy).toHaveBeenCalledTimes(2);
    await stop();
  });
});
