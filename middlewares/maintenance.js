const service = require('../services/maintenanceService');
const { resolveOptionalIdentity } = require('./authentication');

function isExempt(req) {
  const path = req.path.toLowerCase().replace(/\/+$/, '') || '/';
  return req.method === 'OPTIONS'
    || path === '/health' || path.startsWith('/health/')
    || (path === '/maintenance' && ['GET', 'PUT'].includes(req.method))
    || (req.method === 'GET' && ['/auth/me', '/permissions/me', '/session/ping'].includes(path))
    || (req.method === 'POST' && path === '/session/presence');
}

async function maintenanceGate(req, res, next) {
  if (isExempt(req)) return next();
  try {
    const state = await service.getState();
    if (!state.active) return next();
    const user = await resolveOptionalIdentity(req, res.locals.correlationId || 'N/A');
    if (service.canBypass(user)) return next();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      success: false,
      error: { code: 'SYSTEM_MAINTENANCE', message: state.message },
      data: state,
      correlationId: res.locals.correlationId || 'N/A',
    });
  } catch (error) { return next(error); }
}

module.exports = maintenanceGate;
