const logger = require('../config/logger');
const {
  simulateCreateRequest,
  generateSimulationIdentifiers,
} = require('../services/crmSimulationService');

async function getSimulationIdentifiers(req, res, next) {
  const correlationId = res.locals.correlationId || 'N/A';
  try {
    const data = await generateSimulationIdentifiers();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });
  } catch (error) {
    logger.error(`Error in getSimulationIdentifiers: ${error.message}`, {
      correlationId,
      route: { method: req.method, path: req.path },
    });
    next(error);
  }
}

async function simulateCrmRequest(req, res, next) {
  const correlationId = res.locals.correlationId || 'N/A';
  try {
    const data = await simulateCreateRequest(req.body);
    logger.info('CRM create-request simulation completed', { correlationId, route: { method: req.method, path: req.path } });
    res.status(200).json({ success: true, data, correlationId });
  } catch (error) {
    logger.error(`Error in simulateCrmRequest: ${error.message}`, { correlationId, route: { method: req.method, path: req.path } });
    next(error);
  }
}

module.exports = { getSimulationIdentifiers, simulateCrmRequest };
