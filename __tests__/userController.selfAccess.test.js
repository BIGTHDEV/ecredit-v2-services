jest.mock('../config/logger', () => ({ info: jest.fn() }));
jest.mock('../services/userService', () => ({
  assertUserRoleLevelAllowed: jest.fn(),
  setSystemActive: jest.fn(),
  updateUserAccess: jest.fn(),
}));
jest.mock('../services/permissionService', () => ({}));

const userService = require('../services/userService');
const userController = require('../controllers/userController');

describe('userController self-account protection', () => {
  beforeEach(() => jest.clearAllMocks());

  const requestFor = (path, body) => ({
    params: { code: '100' },
    body,
    user: { profile: { CODE: '100', EFFECTIVE_CODE: '100', LOGGED_IN_CODE: '100', ROLE: 'System Admin' } },
  });

  it("rejects setting the signed-in user's account inactive", async () => {
    const next = jest.fn();

    await userController.updateSystemActive(requestFor('', { enabled: false }), {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
    expect(userService.setSystemActive).not.toHaveBeenCalled();
  });

  it("allows editing the signed-in user's roles and permissions while preserving active status", async () => {
    const next = jest.fn();
    const response = { locals: {}, status: jest.fn().mockReturnThis(), json: jest.fn() };
    userService.updateUserAccess.mockResolvedValue({ CODE: '100' });

    await userController.updateUserAccess(
      requestFor('', { roleIds: ['role-a'], permissionIds: ['permission-a'], enabled: true }), response, next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(userService.updateUserAccess).toHaveBeenCalledWith('100', ['role-a'], ['permission-a'], true, 100);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("rejects setting the signed-in user's account inactive through the access endpoint", async () => {
    const next = jest.fn();

    await userController.updateUserAccess(
      requestFor('', { roleIds: ['role-a'], permissionIds: [], enabled: false }), {}, next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
    expect(userService.updateUserAccess).not.toHaveBeenCalled();
  });
});