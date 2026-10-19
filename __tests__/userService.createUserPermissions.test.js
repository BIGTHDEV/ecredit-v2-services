jest.mock('../models', () => ({
  getModels: jest.fn(),
}));

jest.mock('../config/database', () => ({
  getDatabase: jest.fn(),
}));

const { getModels } = require('../models');
const { getDatabase } = require('../config/database');
const { createUser } = require('../services/userService');

describe('userService.createUser per-user permissions', () => {
  it('stores each selected permission state for the new user without changing role defaults', async () => {
    const userPermissionBulkCreate = jest.fn().mockResolvedValue([]);
    const query = jest.fn().mockResolvedValue([]);
    const employeeRecord = {
      EMP_CODE: 'employee-1',
      NAME_ENG: 'Example User',
      USERNAME: 'example',
      INITIALS: 'EX',
      CURRENT_EMAIL: 'example@example.com',
      user: {
        ENABLED: '1',
        userRoles: [{ ENABLED: '1', ROLE_ID: 'role-a', role: { ENABLED: '1', NAME: 'Role A' } }],
      },
    };
    const models = {
      Employee: {
        findByPk: jest.fn().mockResolvedValue({ EMP_CODE: 'employee-1' }),
        findOne: jest.fn().mockResolvedValue(employeeRecord),
      },
      User: { findByPk: jest.fn().mockResolvedValue(null) },
      Role: { findAll: jest.fn().mockResolvedValue([{ ID: 'role-a', ENABLED: '1', LEVEL: 2 }]) },
      RolePermission: { findAll: jest.fn().mockResolvedValue([{ PERMISSION_ID: 'view' }]) },
      Permission: { findAll: jest.fn().mockResolvedValue([{ ID: 'view' }, { ID: 'delete' }]) },
      UserPermission: { bulkCreate: userPermissionBulkCreate },
      CostCenterMapping: {},
      UserRole: { findAll: jest.fn().mockResolvedValue([{ role: { LEVEL: 2 } }]) },
    };
    const database = {
      query,
      transaction: jest.fn((callback) => callback({ id: 'transaction' })),
    };
    getModels.mockReturnValue(models);
    getDatabase.mockReturnValue(database);

    await createUser('employee-1', ['role-a'], ['view'], true, 'admin-1');

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toContain('INSERT INTO USER_SETTINGS (ID, ENABLED');
    expect(query.mock.calls[0][1]).toMatchObject({
      replacements: { employeeCode: 'employee-1', enabled: '1', actorCode: 'admin-1' },
      transaction: { id: 'transaction' },
    });
    expect(query.mock.calls[1][0]).toContain('INSERT INTO USERS');
    expect(query.mock.calls[2][0]).toContain("INSERT INTO USER_ROLES (ID, NAME, DESCRIPTION, USER_ID, ROLE_ID, ENABLED)");
    expect(query.mock.calls[2][0]).toContain("'-', '-'");
    expect(userPermissionBulkCreate).toHaveBeenCalledWith([
      { USER_ID: 'employee-1', PERMISSION_ID: 'view', ENABLED: '1' },
      { USER_ID: 'employee-1', PERMISSION_ID: 'delete', ENABLED: '0' },
    ], { transaction: { id: 'transaction' } });
  });

  it('rejects permissions that are not defaults of the assigned roles', async () => {
    const models = {
      Employee: { findByPk: jest.fn().mockResolvedValue({ EMP_CODE: 'employee-1' }) },
      User: { findByPk: jest.fn().mockResolvedValue(null) },
      Role: { findAll: jest.fn().mockResolvedValue([{ ID: 'role-a', ENABLED: '1', LEVEL: 2 }]) },
      RolePermission: { findAll: jest.fn().mockResolvedValue([{ PERMISSION_ID: 'view' }]) },
      Permission: { findAll: jest.fn().mockResolvedValue([{ ID: 'view' }, { ID: 'delete' }]) },
      UserRole: { findAll: jest.fn().mockResolvedValue([{ role: { LEVEL: 2 } }]) },
    };
    getModels.mockReturnValue(models);
    getDatabase.mockReturnValue({ transaction: jest.fn() });

    await expect(createUser('employee-1', ['role-a'], ['delete'], true, 'admin-1'))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });
});
