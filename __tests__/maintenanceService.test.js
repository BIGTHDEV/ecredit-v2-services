/* eslint-env jest */
jest.mock('../models', () => ({ getModels: jest.fn() }));
const { getModels } = require('../models');
const service = require('../services/maintenanceService');

const startsAt = '2026-10-20T06:00:00.000Z';
const endsAt = '2026-10-20T07:00:00.000Z';
const body = { enabled: true, message: 'Scheduled upgrade', startsAt, endsAt };
const admin = { profile: { LOGGED_IN_ROLE: 'System Admin', LOGGED_IN_CODE: 123 } };
let row;
let model;

beforeEach(() => {
  row = {
    ID: 'system', ENABLED: true, MESSAGE: body.message,
    STARTS_AT: new Date(startsAt), ENDS_AT: new Date(endsAt),
  };
  row.update = jest.fn(async (values) => Object.assign(row, values));
  model = { findByPk: jest.fn().mockResolvedValue(row), sequelize: { literal: (value) => value } };
  getModels.mockReturnValue({ MaintenanceConfig: model });
});

test.each([
  ['2026-10-20T05:59:59.999Z', false],
  [startsAt, true],
  ['2026-10-20T06:59:59.999Z', true],
  [endsAt, false],
  ['2026-10-20T07:00:00.001Z', false],
])('uses inclusive start and exclusive end at %s', (now, active) => {
  expect(service.toState(row, null, new Date(now))).toEqual({
    ...body, active, serverTime: now, canBypass: false,
  });
});

test('disabled maintenance never activates', () => {
  row.ENABLED = false;
  expect(service.toState(row, null, new Date(startsAt)).active).toBe(false);
});

test.each([
  { enabled: 'true' }, { message: '  ' }, { message: null }, { message: 'a'.repeat(4001) },
  { startsAt: null }, { endsAt: null }, { endsAt: startsAt },
  { endsAt: '2026-10-20T05:00:00Z' }, { startsAt: '2026-02-30T01:00:00Z' },
  { startsAt: '2026-10-20T06:00:00' }, { startsAt: undefined },
  { startsAt: '2026-10-20T24:00:00Z' },
  { startsAt: '0000-01-01T00:00:00Z' }, { endsAt: '9999-12-31T23:59:59-01:00' },
])('rejects invalid configuration %p', (change) => {
  expect(() => service.validateSettings({ ...body, ...change })).toThrow();
});

test('normalizes explicit offsets to UTC and supports clearing disabled settings', () => {
  const settings = service.validateSettings({ ...body, startsAt: '2026-10-20T13:00:00+07:00' });
  expect(settings.STARTS_AT.toISOString()).toBe(startsAt);
  expect(service.validateSettings({ enabled: false, message: '', startsAt: null, endsAt: null }))
    .toEqual({ ENABLED: false, MESSAGE: '', STARTS_AT: null, ENDS_AT: null });
});

test.each([
  { ROLE: 'System Admin', IS_VIEWING_AS: true, LOGGED_IN_ROLE: 'Super User' },
  { ROLE: 'System Admin', LOGGED_IN_ROLE: 'User' },
  { ROLE: 'System Admin' }, { LOGGED_IN_ROLE: 'Super User' },
])('denies configuration and bypass for a non-System Admin actor %p', async (profile) => {
  expect(service.canBypass({ profile })).toBe(false);
  await expect(service.updateSettings(body, { profile })).rejects.toMatchObject({ statusCode: 403 });
  expect(model.findByPk).not.toHaveBeenCalled();
});

test('actual System Admin bypasses even while viewing another role, including when inactive', () => {
  const user = { profile: { ...admin.profile, ROLE: 'User', IS_VIEWING_AS: true } };
  expect(service.canBypass(user)).toBe(true);
  row.ENABLED = false;
  expect(service.toState(row, user).canBypass).toBe(true);
});

test('persists settings and actual actor, without resetting state elsewhere', async () => {
  await expect(service.updateSettings(body, admin)).resolves.toMatchObject({ ...body, canBypass: true });
  expect(row.update).toHaveBeenCalledWith(expect.objectContaining({
    ENABLED: true, UPDATED_BY: 123, UPDATED_DATE: 'SYSUTCDATETIME()',
  }));
});

test('missing configuration fails explicitly instead of silently disabling maintenance', async () => {
  model.findByPk.mockResolvedValue(null);
  await expect(service.getState()).rejects.toThrow('migration');
});
