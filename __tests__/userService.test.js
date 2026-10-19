/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));

const { Op } = require('sequelize');
const { getModels } = require('../models');
const userService = require('../services/userService');
const { recordPresence } = require('../services/sessionPresenceService');

describe('userService', () => {
  it('returns audit fields and includes their employee relation in the user list', async () => {
    const employee = {
      EMP_CODE: 123,
      NAME_ENG: 'Example Employee',
      INITIALS: 'EX',
      USERNAME: 'example',
      CURRENT_EMAIL: 'example@example.com',
      user: {
        ENABLED: '1',
        UPDATED_DATE: new Date('2026-10-12T10:29:00.000Z'),
        updatedByEmployee: { EMP_CODE: 456, INITIALS: 'NUC', USERNAME: 'nuttapongc' },
        costCenter: null,
        userRoles: [],
      },
      manager1: null,
      manager2: null,
    };
    recordPresence({ userCode: '123', tabId: 'presence-user-service', active: true });
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [employee], count: 1 });
    const models = { Employee: { findAndCountAll }, User: {}, CostCenterMapping: {}, UserRole: {}, Role: {} };
    getModels.mockReturnValue(models);

    const result = await userService.listUsers({
      page: '1',
      pageSize: '25',
      sort: 'UPDATED_BY',
      dir: 'asc',
      UPDATED_DATE: '2026-10-12',
      UPDATED_BY: 'NUC-nuttapongc',
    });

    const options = findAndCountAll.mock.calls[0][0];
    expect(options.where[Op.and]).toHaveLength(2);
    expect(options.order).toEqual([
      [{ model: models.User, as: 'user' }, { model: models.Employee, as: 'updatedByEmployee' }, 'INITIALS', 'ASC'],
      [{ model: models.User, as: 'user' }, { model: models.Employee, as: 'updatedByEmployee' }, 'USERNAME', 'ASC'],
      ['EMP_CODE', 'ASC'],
    ]);
    expect(options.include[0].include).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: models.Employee, as: 'updatedByEmployee', required: false }),
    ]));
    expect(result.items[0]).toMatchObject({
      UPDATED_DATE: '12 Oct 2026 10:29 AM',
      UPDATED_BY: 'NUC-nuttapongc',
      PRESENCE_STATUS: 'ACTIVE',
    });
  });

  it('filters users by each live presence status before pagination', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    getModels.mockReturnValue({
      Employee: { findAndCountAll },
      User: {},
      CostCenterMapping: {},
      UserRole: {},
      Role: {},
    });
    recordPresence({
      userCode: 'presence-filter-active',
      tabId: 'presence-filter-active-tab',
      active: true,
    });
    recordPresence({
      userCode: 'presence-filter-away',
      tabId: 'presence-filter-away-tab',
      active: false,
    });

    await userService.listUsers({ page: '1', pageSize: '25', PRESENCE_STATUS: 'ACTIVE' });

    const activeOptions = findAndCountAll.mock.calls[0][0];
    expect(activeOptions.where[Op.and][0].EMP_CODE[Op.in]).toContain('presence-filter-active');
    expect(activeOptions.offset).toBe(0);
    expect(activeOptions.limit).toBe(25);

    await userService.listUsers({ page: '1', pageSize: '25', PRESENCE_STATUS: 'AWAY' });

    const awayCodes = findAndCountAll.mock.calls[1][0].where[Op.and][0].EMP_CODE[Op.in];
    expect(awayCodes).toContain('presence-filter-away');
    expect(awayCodes).not.toContain('presence-filter-active');

    await userService.listUsers({ page: '1', pageSize: '25', PRESENCE_STATUS: 'OFFLINE' });

    const offlineCodes = findAndCountAll.mock.calls[2][0].where[Op.and][0].EMP_CODE[Op.notIn];
    expect(offlineCodes).toContain('presence-filter-active');
    expect(offlineCodes).toContain('presence-filter-away');
  });
});
