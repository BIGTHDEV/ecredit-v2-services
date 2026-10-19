jest.mock('../models', () => ({
  getModels: jest.fn(),
}));

jest.mock('../config/database', () => ({
  getDatabase: jest.fn(),
}));

const { getModels } = require('../models');
const { getDatabase } = require('../config/database');
const { assertUserRoleLevelAllowed, updateUserAccess } = require('../services/userService');

describe('userService.updateUserAccess', () => {
  function setup({ existingRoleIds = [], existingPermissionIds = [] } = {}) {
    const transaction = { id: 'transaction' };
    const query = jest.fn().mockImplementation((sql) => Promise.resolve(
      sql.startsWith('SELECT') ? existingRoleIds.map((ROLE_ID) => ({ ROLE_ID })) : [],
    ));
    const models = {
      User: { findByPk: jest.fn().mockResolvedValue({ ID: 'employee-1' }), update: jest.fn().mockResolvedValue([1]) },
      Employee: { findOne: jest.fn().mockResolvedValue(null) },
      Role: { findAll: jest.fn().mockImplementation(({ where }) => {
        const roles = [{ ID: 'role-a', ENABLED: '1', LEVEL: 2 }, { ID: 'role-b', ENABLED: '1', LEVEL: 3 }];
        return Promise.resolve(where?.ID?.[require('sequelize').Op.in]
          ? roles.filter((role) => where.ID[require('sequelize').Op.in].includes(role.ID))
          : roles);
      }) },
      UserRole: { findAll: jest.fn().mockResolvedValue([{ role: { LEVEL: 3 } }]) },
      RolePermission: { findAll: jest.fn().mockResolvedValue([{ PERMISSION_ID: 'view' }, { PERMISSION_ID: 'delete' }]) },
      Permission: { findAll: jest.fn().mockResolvedValue([{ ID: 'view' }, { ID: 'delete' }]) },
      UserPermission: {
        findAll: jest.fn().mockResolvedValue(existingPermissionIds.map((PERMISSION_ID) => ({ PERMISSION_ID }))),
        update: jest.fn().mockResolvedValue([1]),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    getModels.mockReturnValue(models);
    getDatabase.mockReturnValue({ query, transaction: jest.fn((callback) => callback(transaction)) });
    return { models, query, transaction };
  }

  it('updates status, re-enables kept roles, adds new roles, and upserts every permission state', async () => {
    const { models, query, transaction } = setup({ existingRoleIds: ['role-a'], existingPermissionIds: ['view'] });

    await updateUserAccess('employee-1', ['role-a', 'role-b'], ['delete'], false, 'admin-1');

    expect(models.User.update).toHaveBeenCalledWith(
      expect.objectContaining({ ENABLED: '0', UPDATED_BY: 'admin-1' }),
      { where: { ID: 'employee-1' }, transaction },
    );
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql[1]).toContain('UPDATE USER_ROLES SET ENABLED = 0');
    expect(sql[2]).toContain('SET ENABLED = 1');
    expect(sql[3]).toContain("INSERT INTO USER_ROLES (ID, NAME, DESCRIPTION, USER_ID, ROLE_ID, ENABLED)");
    expect(query.mock.calls[3][1].replacements).toEqual({ employeeCode: 'employee-1', roleId: 'role-b' });
    expect(models.UserPermission.update).toHaveBeenCalledWith(
      { ENABLED: '0' },
      { where: { USER_ID: 'employee-1', PERMISSION_ID: 'view' }, transaction },
    );
    expect(models.UserPermission.create).toHaveBeenCalledWith(
      { USER_ID: 'employee-1', PERMISSION_ID: 'delete', ENABLED: '1' },
      { transaction },
    );
  });

  it('rejects unknown users', async () => {
    const { models } = setup();
    models.User.findByPk.mockResolvedValue(null);

    await expect(updateUserAccess('missing', ['role-a'], [], true, 'admin-1')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects assigning a higher-level role than the actor role level', async () => {
    const { models, query } = setup();
    models.UserRole.findAll.mockResolvedValue([{ role: { LEVEL: 2 } }]);

    await expect(updateUserAccess('employee-1', ['role-b'], [], true, 'admin-1'))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects managing a user who already has a higher-level role', async () => {
    const { models } = setup();
    models.UserRole.findAll.mockImplementation(({ where }) => Promise.resolve([
      { role: { LEVEL: where.USER_ID === 'admin-1' ? 2 : 3 } },
    ]));

    await expect(assertUserRoleLevelAllowed('admin-1', 'employee-1'))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('rejects permissions that are not defaults of the assigned roles', async () => {
    const { models, query } = setup();
    models.RolePermission.findAll.mockResolvedValue([{ PERMISSION_ID: 'view' }]);

    await expect(updateUserAccess('employee-1', ['role-a'], ['delete'], true, 'admin-1'))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(query).not.toHaveBeenCalled();
  });
});
