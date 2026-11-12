/* eslint-env jest */
jest.mock('../models', () => ({ getModels: jest.fn() }));
const { getModels } = require('../models');
const { validateSettings, intervalMilliseconds, listSettings, updateSettings } = require('../services/emailReminderConfigService');

describe('email reminder settings', () => {
  test.each([null, {}, { intervalValue: 0 }, { intervalValue: -1 }, { intervalValue: 1.5 }, { intervalValue: 366 }, { intervalValue: '1' }])('rejects invalid interval %j', (body) => {
    expect(() => validateSettings({ intervalUnit: 'days', enabled: true, ...body })).toThrow();
  });

  test.each(['weeks', '__proto__', '', null])('rejects unsupported unit %s', (intervalUnit) => {
    expect(() => validateSettings({ intervalValue: 1, intervalUnit, enabled: true })).toThrow();
  });

  test.each([[7], [-1], [1.5], [1, 1], '1,2'])('rejects invalid weekday selection %j', (daysOfWeek) => {
    expect(() => validateSettings({ intervalValue: 1, intervalUnit: 'days', enabled: true, daysOfWeek })).toThrow();
  });

  test('accepts no send days to pause reminders and defaults omitted days to the full week', () => {
    expect(validateSettings({ intervalValue: 1, intervalUnit: 'days', enabled: true, daysOfWeek: [] }).DAYS_OF_WEEK).toEqual([]);
    expect(validateSettings({ intervalValue: 1, intervalUnit: 'days', enabled: true }).DAYS_OF_WEEK)
      .toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('requires a boolean enabled flag', () => {
    expect(() => validateSettings({ intervalValue: 1, intervalUnit: 'days', enabled: 'true' })).toThrow();
  });

  test.each([['minutes', 60000], ['hours', 3600000], ['days', 86400000]])('converts %s exactly', (unit, multiplier) => {
    expect(intervalMilliseconds({ INTERVAL_VALUE: 365, INTERVAL_UNIT: unit, ENABLED: true })).toBe(365 * multiplier);
  });

  test('updates only an allowed template and records the administrator', async () => {
    const row = { ID: 'id', TEMPLATE: 'request-final', update: jest.fn(async (values) => Object.assign(row, values)) };
    const model = { findOne: jest.fn().mockResolvedValue(row), sequelize: { literal: (value) => value } };
    getModels.mockReturnValue({ EmailReminderConfig: model });
    await expect(updateSettings('request-final', { intervalValue: 2, intervalUnit: 'hours', enabled: true }, 123))
      .resolves.toEqual({
        id: 'id', template: 'request-final', intervalValue: 2, intervalUnit: 'hours', enabled: true,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6], daysBeforeExpiry: null,
      });
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({
      DAYS_OF_WEEK: '[0,1,2,3,4,5,6]', DAYS_BEFORE_EXPIRY: null, UPDATED_BY: 123, UPDATED_DATE: 'GETDATE()',
    }));
    await expect(updateSettings('request-completed', {}, 123)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('requires a valid expiry lead time for Temporary settings', async () => {
    expect(() => validateSettings({
      intervalValue: 1, intervalUnit: 'days', enabled: false,
    }, 'request-temporary')).toThrow('daysBeforeExpiry');
    expect(() => validateSettings({
      intervalValue: 1, intervalUnit: 'days', enabled: false, daysBeforeExpiry: 0,
    }, 'request-temporary')).toThrow('daysBeforeExpiry');
    expect(validateSettings({
      intervalValue: 1, intervalUnit: 'days', enabled: false, daysBeforeExpiry: 30,
    }, 'request-temporary').DAYS_BEFORE_EXPIRY).toBe(30);
  });

  test('reports missing migration data explicitly', async () => {
    getModels.mockReturnValue({ EmailReminderConfig: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) } });
    await expect(listSettings()).rejects.toThrow('migration');
    await expect(updateSettings('request-draft', { intervalValue: 1, intervalUnit: 'days', enabled: false }, 123)).rejects.toThrow('migration');
  });

  test('returns all five configured templates, including disabled ones', async () => {
    const templates = ['request-approval', 'request-backward', 'request-draft', 'request-final', 'request-temporary'];
    getModels.mockReturnValue({
      EmailReminderConfig: {
        findAll: jest.fn().mockResolvedValue(templates.map((template) => ({
          ID: template, TEMPLATE: template, INTERVAL_VALUE: 1, INTERVAL_UNIT: 'days', ENABLED: false,
          DAYS_OF_WEEK: '[0,1,2,3,4,5,6]', DAYS_BEFORE_EXPIRY: template === 'request-temporary' ? 30 : null,
        }))),
      },
    });
    expect(await listSettings()).toEqual(templates.map((template) => ({
      id: template, template, intervalValue: 1, intervalUnit: 'days', enabled: false,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], daysBeforeExpiry: template === 'request-temporary' ? 30 : null,
    })));
  });
});
