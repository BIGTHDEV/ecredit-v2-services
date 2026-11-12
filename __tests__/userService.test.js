/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));

const { Op, Sequelize } = require('sequelize');
const { getModels } = require('../models');
const actualModelRegistry = jest.requireActual('../models');
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
    expect(options.where.WORK_STATUS).toBeUndefined();
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
    const userInclude = options.include.find((include) => include.as === 'user');
    const updatedByInclude = userInclude.include.find((include) => include.as === 'updatedByEmployee');
    expect(userInclude.where[Op.and]).toHaveLength(1);
    expect(updatedByInclude.required).toBe(true);
    expect(updatedByInclude.where[Op.and]).toHaveLength(2);
    expect(options.order).toEqual([
      [{ model: models.User, as: 'user' }, { model: models.Employee, as: 'updatedByEmployee' }, 'INITIALS', 'ASC'],
      [{ model: models.User, as: 'user' }, { model: models.Employee, as: 'updatedByEmployee' }, 'USERNAME', 'ASC'],
      ['EMP_CODE', 'ASC'],
    ]);
    expect(updatedByInclude).toEqual(expect.objectContaining({
      model: models.Employee,
      as: 'updatedByEmployee',
      attributes: ['EMP_CODE', 'INITIALS', 'USERNAME'],
    }));
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

    const options = findAndCountAll.mock.calls[0][0];
    const userInclude = options.include.find((include) => include.as === 'user');
    const identityCondition = filterKey === 'USER'
      ? options.where[Op.and].find((condition) => condition[Op.or])
      : filterKey === 'UPDATED_BY'
        ? userInclude.include.find((include) => include.as === 'updatedByEmployee').where
        : options.include.find((include) => include.as === association).where;
    expect(identityCondition).toBeDefined();
    expect(identityCondition[Op.or]).toHaveLength(2);
    const generatedCondition = require('util').inspect(identityCondition, { depth: null });
    expect(generatedCondition).toContain('INITIALS');
    expect(generatedCondition).toContain('USERNAME');
    expect(generatedCondition).toContain('%NUC%');
  });

  it.each([
    ['COST_CENTER_DESC', 'COST_CENTER_DESC'],
    ['BU', 'BU'],
    ['DEPARTMENT', 'DEPARTMENT'],
  ])('applies the %s cost-center filter on its include', async (filterKey, field) => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    getModels.mockReturnValue({ Employee: { findAndCountAll }, User: {}, CostCenterMapping: {}, UserRole: {}, Role: {} });

    await userService.listUsers({ page: '1', pageSize: '25', [filterKey]: 'sample' });

    const userInclude = findAndCountAll.mock.calls[0][0].include.find((include) => include.as === 'user');
    const costCenterInclude = userInclude.include.find((include) => include.as === 'costCenter');
    expect(costCenterInclude.required).toBe(true);
    expect(costCenterInclude.where).toEqual({ [field]: { [Op.like]: '%sample%' } });
  });

  it('generates valid MSSQL aliases for nested user filters', async () => {
    const sequelize = new Sequelize('user-filter-test', 'user', 'password', {
      dialect: 'mssql',
      logging: false,
    });

    try {
      const models = actualModelRegistry.initModels(sequelize);
      models.Employee.findAndCountAll = jest.fn(async (options) => {
        const queryOptions = { ...options, model: models.Employee };
        models.Employee._validateIncludedElements(queryOptions);
        const sql = sequelize.dialect.queryGenerator.selectQuery(
          models.Employee.getTableName(),
          queryOptions,
          models.Employee,
        );
        expect(sql).toContain('[user->costCenter].[BU]');
        expect(sql).not.toContain('[user->costCenter.BU]');
        return { rows: [], count: 0 };
      });
      getModels.mockReturnValue(models);

      await userService.listUsers({
        page: '1',
        pageSize: '25',
        BU: 'Business',
        ROLES: 'Credit',
        UPDATED_BY: 'NUC-nuttapongc',
        MANAGER_1: 'MGR',
        SYSTEM_ACTIVE: '1',
        UPDATED_DATE: '2026-11-12',
      });
    } finally {
      await sequelize.close();
    }
  });

  it('filters role names through a separate join without trimming displayed roles', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    getModels.mockReturnValue({ Employee: { findAndCountAll }, User: {}, CostCenterMapping: {}, UserRole: {}, Role: {} });

    await userService.listUsers({ page: '1', pageSize: '25', ROLES: 'Credit' });

    const userInclude = findAndCountAll.mock.calls[0][0].include.find((include) => include.as === 'user');
    const displayedRolesInclude = userInclude.include.find((include) => include.as === 'userRoles');
    const roleFilterInclude = userInclude.include.find((include) => include.as === 'userRolesFilter');
    expect(displayedRolesInclude.required).toBe(false);
    expect(displayedRolesInclude.where).toBeUndefined();
    expect(roleFilterInclude.required).toBe(true);
    expect(roleFilterInclude.where.ENABLED[Op.in]).toContain('1');
    expect(roleFilterInclude.include[0].where).toEqual({ NAME: { [Op.like]: '%Credit%' } });
  });

  it.each([
    ['1', ['1', 1, true]],
    ['0', ['0', 0, false]],
  ])('filters system access status %s', async (value, enabledValues) => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    getModels.mockReturnValue({ Employee: { findAndCountAll }, User: {}, CostCenterMapping: {}, UserRole: {}, Role: {} });

    await userService.listUsers({ page: '1', pageSize: '25', SYSTEM_ACTIVE: value });

    const userInclude = findAndCountAll.mock.calls[0][0].include.find((include) => include.as === 'user');
    expect(userInclude.where[Op.and]).toContainEqual({
      ENABLED: { [Op.in]: enabledValues },
    });
  });

  it.each([
    ['USER', 'Employee'],
    ['MANAGER_1', 'manager1'],
  ])('matches the displayed INITIALS-USERNAME value for %s', async (filterKey, association) => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    getModels.mockReturnValue({ Employee: { findAndCountAll }, User: {}, CostCenterMapping: {}, UserRole: {}, Role: {} });

    await userService.listUsers({ page: '1', pageSize: '25', [filterKey]: 'NUC-nuttapongc' });

    const options = findAndCountAll.mock.calls[0][0];
    const identityCondition = filterKey === 'USER'
      ? options.where[Op.and].find((condition) => condition[Op.and])
      : options.include.find((include) => include.as === association).where;
    expect(identityCondition[Op.and]).toEqual([
      { INITIALS: { [Op.like]: '%NUC%' } },
      { USERNAME: { [Op.like]: '%nuttapongc%' } },
    ]);
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
