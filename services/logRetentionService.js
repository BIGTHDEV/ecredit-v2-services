const { Op } = require('sequelize');
const { getModels } = require('../models');
const logger = require('../config/logger');

const RETENTION_DAYS = 90;
const BATCH_SIZE = 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function purgeExpiredLogs(shouldStop = () => false) {
  const { Log } = getModels();
  let totalDeleted = 0;
  while (!shouldStop()) {
    const deleted = await Log.destroy({
      where: { CREATED_DATE: { [Op.lt]: Log.sequelize.literal(`DATEADD(DAY, -${RETENTION_DAYS}, GETDATE())`) } },
      limit: BATCH_SIZE,
    });
    totalDeleted += deleted;
    if (deleted < BATCH_SIZE) break;
  }
  return totalDeleted;
}

function startLogRetentionScheduler() {
  let stopped = false;
  let timer;
  let running;
  const run = () => {
    running = purgeExpiredLogs(() => stopped)
      .then((deleted) => {
        if (deleted > 0) logger.info('Expired LOGS deleted', { deleted, retentionDays: RETENTION_DAYS });
      })
      .catch((error) => logger.error('Log retention cleanup failed', { message: error.message }))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(run, CHECK_INTERVAL_MS);
          timer.unref();
        }
      });
  };
  timer = setTimeout(run, 0);
  timer.unref();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

module.exports = { RETENTION_DAYS, BATCH_SIZE, CHECK_INTERVAL_MS, purgeExpiredLogs, startLogRetentionScheduler };
