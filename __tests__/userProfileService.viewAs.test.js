/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));

const { getModels } = require('../models');
const { getUserProfileByEmail } = require('../services/userProfileService');

function createProfileModels(options) {
  const { viewAsCode, viewAsEmployee } = options;
  const enabled = Object.prototype.hasOwnProperty.call(options, 'enabled') ? options.enabled : '1';
  const mainEmployee = {
    EMP_CODE: '20221459',
    CURRENT_EMAIL: 'main@example.com',
    USERNAME: 'main',
    INITIALS: 'MU',
    NAME_ENG: 'Main User',
    manager1: null,
    manager2: null,
  };
  const targetEmployee = viewAsEmployee && {
    EMP_CODE: viewAsCode,
    CURRENT_EMAIL: 'viewed@example.com',
    USERNAME: 'viewed',
    INITIALS: 'VU',
    NAME_ENG: 'Viewed User',
  };
  const UserRole = {
    findOne: jest.fn(async ({ where }) => ({
      role: where.USER_ID === '20221459'
        ? { ID: 'system-admin-id', NAME: 'System Admin' }
        : { ID: 'analyst-id', NAME: 'Credit Analyst' },
    })),
    findAll: jest.fn(async ({ where }) => [{
      role: { NAME: where.USER_ID === '20221459' ? 'System Admin' : 'Credit Analyst' },
    }]),
  };
  const Employee = {
    findOne: jest.fn().mockResolvedValue({ manager1: null, manager2: null }),
  };
  const models = {
    User: {
      findOne: jest.fn(async ({ where }) => (enabled === '1' && where.ENABLED === '1' ? {
        ID: '20221459',
        VIEW_AS: viewAsCode,
        employee: mainEmployee,
        costCenter: null,
        viewAsEmployee: targetEmployee,
      } : null)),
    },
    Employee,
    UserRole,
    Role: {},
    CostCenterMapping: { findOne: jest.fn().mockResolvedValue(null) },
  };
  getModels.mockReturnValue(models);
  return models;
}

describe('userProfileService View As identity', () => {
  beforeEach(() => getModels.mockReset());

  it('uses the logged-in user when VIEW_AS is null', async () => {
    createProfileModels({ viewAsCode: null, viewAsEmployee: null });

    const profile = await getUserProfileByEmail('main@example.com');

    expect(profile.CODE).toBe('20221459');
    expect(profile.LOGGED_IN_CODE).toBe('20221459');
    expect(profile.LOGGED_IN_INITIALS).toBe('MU');
    expect(profile.LOGGED_IN_FULL_NAME).toBe('Main User');
    expect(profile.IS_VIEWING_AS).toBe(false);
  });

  it.each(['0', undefined])('rejects a user whose ENABLED value is %s', async (enabled) => {
    const models = createProfileModels({ viewAsCode: null, viewAsEmployee: null, enabled });

    await expect(getUserProfileByEmail('main@example.com')).resolves.toBeNull();
    expect(models.User.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { ENABLED: '1' },
    }));
  });

  it('does not enter View As when VIEW_AS equals the logged-in ID', async () => {
    createProfileModels({ viewAsCode: '20221459', viewAsEmployee: {} });

    const profile = await getUserProfileByEmail('main@example.com');

    expect(profile.CODE).toBe('20221459');
    expect(profile.IS_VIEWING_AS).toBe(false);
  });

  it('uses the selected employee and their role when VIEW_AS differs from the logged-in ID', async () => {
    createProfileModels({ viewAsCode: '20261631', viewAsEmployee: {} });

    const profile = await getUserProfileByEmail('main@example.com');

    expect(profile.CODE).toBe('20261631');
    expect(profile.ROLE).toBe('Credit Analyst');
    expect(profile.LOGGED_IN_CODE).toBe('20221459');
    expect(profile.LOGGED_IN_USERNAME).toBe('main');
    expect(profile.LOGGED_IN_INITIALS).toBe('MU');
    expect(profile.LOGGED_IN_FULL_NAME).toBe('Main User');
    expect(profile.LOGGED_IN_ROLE).toBe('System Admin');
    expect(profile.LOGGED_IN_ROLE_ID).toBe('system-admin-id');
    expect(profile.IS_VIEWING_AS).toBe(true);
  });

  it('rejects a non-null View As code that does not resolve to an employee', async () => {
    createProfileModels({ viewAsCode: '20261631', viewAsEmployee: null });

    await expect(getUserProfileByEmail('main@example.com')).rejects.toMatchObject({
      statusCode: 403,
      code: 'INVALID_VIEW_AS_TARGET',
    });
  });
});
