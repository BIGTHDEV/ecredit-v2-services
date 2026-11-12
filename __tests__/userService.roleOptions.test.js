/* eslint-env jest */

jest.mock('../models', () => ({
  getModels: jest.fn(),
}));

const { getModels } = require('../models');
const { listRoleOptions } = require('../services/userService');

describe('userService.listRoleOptions', () => {
  it('only returns permission IDs whose permission records are enabled', async () => {
    const Permission = {};
    const Role = {
      findAll: jest.fn().mockResolvedValue([
        { ID: 'role-a', NAME: 'Role A', LEVEL: 1 },
      ]),
    };
    const RolePermission = {
      findAll: jest.fn().mockResolvedValue([
        { ROLE_ID: 'role-a', PERMISSION_ID: 'active-permission' },
      ]),
    };
    getModels.mockReturnValue({ Role, RolePermission, Permission });

    const result = await listRoleOptions();

    expect(result).toEqual([{
      ID: 'role-a',
      NAME: 'Role A',
      LEVEL: 1,
      PERMISSION_IDS: ['active-permission'],
    }]);
    expect(RolePermission.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { ENABLED: '1' },
      include: [expect.objectContaining({
        model: Permission,
        as: 'permission',
        required: true,
        where: { ENABLED: '1' },
      })],
    }));
  });
});
