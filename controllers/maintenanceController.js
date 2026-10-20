const service = require('../services/maintenanceService');
const { resolveOptionalIdentity } = require('../middlewares/authentication');

async function get(req, res, next) {
  try {
    const user = await resolveOptionalIdentity(req, res.locals.correlationId || 'N/A');
    const data = await service.getState(user);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

async function update(req, res, next) {
  try {
    const data = await service.updateSettings(req.body, req.user);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

module.exports = { get, update };
