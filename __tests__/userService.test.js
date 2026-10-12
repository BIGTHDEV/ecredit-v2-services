/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));

const { Op } = require('sequelize');
const { getModels } = require('../models');
const userService = require('../services/userService');

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
    });
  });
});
