/* eslint-env jest */

const {
  HEARTBEAT_TTL_MS,
  getPresenceStatus,
  getPresenceUserCodesByStatus,
  getTrackedPresenceUserCodes,
  recordPresence,
} = require('../services/sessionPresenceService');

describe('sessionPresenceService', () => {
  it('aggregates active tabs ahead of idle tabs', () => {
    const now = Date.now();
    recordPresence({ userCode: 'presence-multi-tab', tabId: 'active-tab', active: true }, now);
    recordPresence({ userCode: 'presence-multi-tab', tabId: 'idle-tab', active: false }, now);

    expect(getPresenceStatus('presence-multi-tab', now)).toBe('ACTIVE');

    recordPresence({ userCode: 'presence-multi-tab', tabId: 'active-tab', active: false }, now + 1);
    expect(getPresenceStatus('presence-multi-tab', now + 1)).toBe('AWAY');
  });

  it('marks a user offline after all tab heartbeats expire', () => {
    const now = Date.now();
    recordPresence({ userCode: 'presence-expiring', tabId: 'visible-tab', active: false }, now);

    expect(getPresenceStatus('presence-expiring', now + HEARTBEAT_TTL_MS)).toBe('AWAY');
    expect(getPresenceStatus('presence-expiring', now + HEARTBEAT_TTL_MS + 1)).toBe('OFFLINE');
  });

  it('provides current user codes grouped by live presence status', () => {
    const now = Date.now();
    recordPresence({ userCode: 'presence-active-filter', tabId: 'active-filter-tab', active: true }, now);
    recordPresence({ userCode: 'presence-away-filter', tabId: 'away-filter-tab', active: false }, now);

    expect(getPresenceUserCodesByStatus('ACTIVE', now)).toContain('presence-active-filter');
    expect(getPresenceUserCodesByStatus('ACTIVE', now)).not.toContain('presence-away-filter');
    expect(getPresenceUserCodesByStatus('AWAY', now)).toContain('presence-away-filter');
    expect(getTrackedPresenceUserCodes(now)).toEqual(expect.arrayContaining([
      'presence-active-filter',
      'presence-away-filter',
    ]));
  });

  it('requires a valid user code, tab ID, and active flag', () => {
    expect(() => recordPresence({ userCode: '', tabId: 'tab', active: true })).toThrow();
    expect(() => recordPresence({ userCode: 'presence-invalid', tabId: '', active: true })).toThrow();
    expect(() => recordPresence({ userCode: 'presence-invalid', tabId: 'tab', active: 'true' })).toThrow();
  });
});
