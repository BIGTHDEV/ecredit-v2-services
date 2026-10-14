const notificationService = require('../services/notificationService');

function notificationEmail(req) {
  const profile = req.user?.profile;
  if (profile?.IS_VIEWING_AS) {
    return profile.EFFECTIVE_EMAIL || profile.EMAIL || '';
  }
  return profile?.EFFECTIVE_EMAIL || profile?.EMAIL || req.user?.email || '';
}

function respond(res, data) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
}

async function list(req, res, next) {
  try {
    respond(res, await notificationService.listForUser(notificationEmail(req), req.query));
  } catch (error) {
    next(error);
  }
}

async function unreadCount(req, res, next) {
  try {
    respond(res, { unreadCount: await notificationService.countUnread(notificationEmail(req)) });
  } catch (error) {
    next(error);
  }
}

async function markRead(req, res, next) {
  try {
    respond(res, await notificationService.markRead(req.params.id, notificationEmail(req)));
  } catch (error) {
    next(error);
  }
}

async function markUnread(req, res, next) {
  try {
    respond(res, await notificationService.markUnread(req.params.id, notificationEmail(req)));
  } catch (error) {
    next(error);
  }
}

async function markAllRead(req, res, next) {
  try {
    respond(res, await notificationService.markAllRead(notificationEmail(req)));
  } catch (error) {
    next(error);
  }
}

module.exports = { list, unreadCount, markRead, markUnread, markAllRead };
