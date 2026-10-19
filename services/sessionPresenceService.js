const HEARTBEAT_TTL_MS = 2 * 60 * 1000;
const PRESENCE_STATES = Object.freeze({
  ACTIVE: 'ACTIVE',
  AWAY: 'AWAY',
  OFFLINE: 'OFFLINE',
});

const presenceByUser = new Map();

function pruneExpiredPresence(now = Date.now()) {
  for (const [userCode, sessions] of presenceByUser) {
    for (const [tabId, presence] of sessions) {
      if (now - presence.lastSeenAt > HEARTBEAT_TTL_MS) sessions.delete(tabId);
    }
    if (sessions.size === 0) presenceByUser.delete(userCode);
  }
}

function recordPresence({ userCode, tabId, active }, now = Date.now()) {
  const normalizedCode = String(userCode ?? '').trim();
  if (!normalizedCode || typeof tabId !== 'string' || !tabId || typeof active !== 'boolean') {
    throw new Error('A user code, tab ID, and active state are required to record presence.');
  }

  pruneExpiredPresence(now);
  let sessions = presenceByUser.get(normalizedCode);
  if (!sessions) {
    sessions = new Map();
    presenceByUser.set(normalizedCode, sessions);
  }
  sessions.set(tabId, { active, lastSeenAt: now });
}

function getPresenceStatus(userCode, now = Date.now()) {
  const normalizedCode = String(userCode ?? '').trim();
  if (!normalizedCode) return PRESENCE_STATES.OFFLINE;

  const sessions = presenceByUser.get(normalizedCode);
  if (!sessions) return PRESENCE_STATES.OFFLINE;

  for (const [tabId, presence] of sessions) {
    if (now - presence.lastSeenAt > HEARTBEAT_TTL_MS) sessions.delete(tabId);
  }
  if (sessions.size === 0) {
    presenceByUser.delete(normalizedCode);
    return PRESENCE_STATES.OFFLINE;
  }
  return [...sessions.values()].some((presence) => presence.active)
    ? PRESENCE_STATES.ACTIVE
    : PRESENCE_STATES.AWAY;
}

function getTrackedPresenceUserCodes(now = Date.now()) {
  pruneExpiredPresence(now);
  return [...presenceByUser.keys()];
}

function getPresenceUserCodesByStatus(status, now = Date.now()) {
  pruneExpiredPresence(now);
  return [...presenceByUser]
    .filter(([, sessions]) => {
      const currentStatus = [...sessions.values()].some((presence) => presence.active)
        ? PRESENCE_STATES.ACTIVE
        : PRESENCE_STATES.AWAY;
      return currentStatus === status;
    })
    .map(([userCode]) => userCode);
}

const cleanupInterval = setInterval(pruneExpiredPresence, HEARTBEAT_TTL_MS);
cleanupInterval.unref?.();

module.exports = {
  HEARTBEAT_TTL_MS,
  PRESENCE_STATES,
  getPresenceStatus,
  getPresenceUserCodesByStatus,
  getTrackedPresenceUserCodes,
  recordPresence,
};
