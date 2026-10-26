/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));

const { Op } = require('sequelize');
const { getModels } = require('../models');
const userService = require('../services/userService');
const { recordPresence } = require('../services/sessionPresenceService');

describe('userService', () => {
  it.each([
    ['Name', 'Example Employee'],
    ['Employee Code', '20001234'],
    ['Email', 'employee@example.com'],
    ['Initials', 'EX'],
    ['Username', 'example'],
  ])('searches all five available employee fields for %s input', async (field, value) => {
    const findAll = jest.fn().mockResolvedValue([]);
    const models = { Employee: { findAll }, User: {} };
    getModels.mockReturnValue(models);

    await userService.listAvailableEmployees(`  ${value}  `);

    const options = findAll.mock.calls[0][0];
    expect(options.where[Op.or]).toEqual([
      { NAME_ENG: { [Op.like]: `%${value}%` } },
      { EMP_CODE: { [Op.like]: `%${value}%` } },
      { CURRENT_EMAIL: { [Op.like]: `%${value}%` } },
      { INITIALS: { [Op.like]: `%${value}%` } },
      { USERNAME: { [Op.like]: `%${value}%` } },
    ]);
    expect(options.where.WORK_STATUS).toBe('3');
    expect(options.where['$user.ID$']).toEqual({ [Op.is]: null });
    expect(options.include).toEqual([{ model: models.User, as: 'user', required: false, attributes: [] }]);
    expect(options.limit).toBe(100);
    expect(options.order).toEqual([['NAME_ENG', 'ASC'], ['EMP_CODE', 'ASC']]);
  });

  it('does not apply a search filter for a blank employee search', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    getModels.mockReturnValue({ Employee: { findAll }, User: {} });

    await userService.listAvailableEmployees('   ');

    expect(findAll.mock.calls[0][0].where[Op.or]).toBeUndefined();
  });

  it('preserves the available employee response shape and normalizes missing fields', async () => {
    const findAll = jest.fn().mockResolvedValue([
      { EMP_CODE: 20001234, NAME_ENG: 'Example Employee', INITIALS: 'EX', USERNAME: 'example', CURRENT_EMAIL: 'EXAMPLE@Example.com' },
      { EMP_CODE: 20001235, NAME_ENG: null, INITIALS: null, USERNAME: null, CURRENT_EMAIL: null },
    ]);
    getModels.mockReturnValue({ Employee: { findAll }, User: {} });

    await expect(userService.listAvailableEmployees()).resolves.toEqual([
      { CODE: '20001234', NAME: 'Example Employee', USER: 'EX-example', EMAIL: 'example@example.com' },
      { CODE: '20001235', NAME: '', USER: '-', EMAIL: '' },
    ]);
  });

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

  it.each([
    ['USER', 'Employee'],
    ['MANAGER_1', 'manager1'],
    ['MANAGER_2', 'manager2'],
    ['UPDATED_BY', 'user.updatedByEmployee'],
  ])('matches INITIALS or USERNAME for %s filters', async (filterKey, association) => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    getModels.mockReturnValue({ Employee: { findAndCountAll }, User: {}, CostCenterMapping: {}, UserRole: {}, Role: {} });

    await userService.listUsers({ page: '1', pageSize: '25', [filterKey]: 'NUC' });

    const conditions = findAndCountAll.mock.calls[0][0].where[Op.and];
    const identityCondition = conditions.find((condition) => condition[Op.or]);
    expect(identityCondition).toBeDefined();
    expect(identityCondition[Op.or]).toHaveLength(2);
    const generatedCondition = require('util').inspect(identityCondition, { depth: null });
    expect(generatedCondition).toContain('INITIALS');
    expect(generatedCondition).toContain('USERNAME');
    expect(generatedCondition).toContain('%NUC%');
    if (association !== 'Employee') {
      expect(generatedCondition).toContain(`$${association}.INITIALS$`);
      expect(generatedCondition).toContain(`$${association}.USERNAME$`);
    }
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
