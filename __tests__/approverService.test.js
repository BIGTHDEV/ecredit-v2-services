/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));

const { getModels } = require('../models');
const { Op } = require('sequelize');
const approverService = require('../services/approverService');

describe('approverService', () => {
  it('loads the list with joined employee fields, filters, stable sorting, and pagination through Sequelize', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({
      count: 1,
      rows: [{
        ID: 'approver-id',
        APPROVER_ID: 123,
        APPROVER_TYPE_ID: 'type-id',
        DESCRIPTION: 'Finance',
        ENABLED: true,
        UPDATED_DATE: new Date('2026-10-12T10:29:00.000Z'),
        UPDATED_BY: 456,
        employee: {
          NAME_ENG: 'Example Employee',
          INITIALS: 'EX',
          USERNAME: 'example',
          CURRENT_EMAIL: 'EXAMPLE@EXAMPLE.COM',
        },
        approverType: { NAME: 'Finance' },
        updatedByEmployee: { INITIALS: 'NUC', USERNAME: 'nuttapongc' },
      }],
    });
    const Employee = {};
    const ApproverType = {};
    getModels.mockReturnValue({ Approver: { findAndCountAll }, ApproverType, Employee });

    const result = await approverService.listApprovers({
      page: '2',
      pageSize: '10',
      sort: 'NAME',
      dir: 'desc',
      CODE: '12',
      NAME: 'Example',
      DESCRIPTION: 'Finance',
      EMAIL: 'example@',
      UPDATED_BY: 'NUC-nuttapongc',
    });

    expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ [Op.and]: expect.any(Array) }),
      include: expect.arrayContaining([expect.objectContaining({
        model: Employee,
        as: 'employee',
        required: true,
        attributes: ['EMP_CODE', 'NAME_ENG', 'INITIALS', 'USERNAME', 'CURRENT_EMAIL'],
      }), expect.objectContaining({
        model: ApproverType,
        as: 'approverType',
        required: false,
        attributes: ['NAME'],
      }), expect.objectContaining({
        model: Employee,
        as: 'updatedByEmployee',
        required: true,
        attributes: ['EMP_CODE', 'INITIALS', 'USERNAME'],
      })]),
      distinct: true,
      order: [[{ model: Employee, as: 'employee' }, 'NAME_ENG', 'DESC'], ['ID', 'ASC']],
      offset: 10,
      limit: 10,
    }));
    expect(result).toEqual({
      items: [{
        ID: 'approver-id',
        CODE: '123',
        APPROVER_TYPE_ID: 'type-id',
        APPROVER_TYPE: 'Finance',
        NAME: 'Example Employee',
        DESCRIPTION: 'Finance',
        EMAIL: 'example@example.com',
        UPDATED_DATE: '12 Oct 2026 10:29 AM',
        UPDATED_BY: 'NUC-nuttapongc',
        ACTIVE: true,
      }],
      pagination: { page: 2, pageSize: 10, totalItems: 1, totalPages: 1 },
    });
  });

  it('filters and sorts by approver type through the joined type table', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });
    const Employee = {};
    const ApproverType = {};
    getModels.mockReturnValue({ Approver: { findAndCountAll }, ApproverType, Employee });

    await approverService.listApprovers({ APPROVER_TYPE: 'Finance', sort: 'APPROVER_TYPE', dir: 'desc' });

    expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.arrayContaining([expect.objectContaining({
        model: ApproverType,
        as: 'approverType',
        attributes: ['NAME'],
        required: true,
        where: { NAME: { [Op.like]: '%Finance%' } },
      })]),
      order: [[{ model: ApproverType, as: 'approverType' }, 'NAME', 'DESC'], ['APPROVER_ID', 'ASC'], ['ID', 'ASC']],
    }));
  });

  it('returns only enabled approver types sorted by their configured order', async () => {
    const findAll = jest.fn().mockResolvedValue([{ ID: 'type-id', NAME: 'Finance' }]);
    getModels.mockReturnValue({ ApproverType: { findAll } });

    const result = await approverService.listApproverTypeOptions();

    expect(findAll).toHaveBeenCalledWith({
      attributes: ['ID', 'NAME'],
      where: { ENABLED: true },
      order: [['SORTING', 'ASC'], ['ID', 'ASC']],
    });
    expect(result).toEqual([{ ID: 'type-id', NAME: 'Finance' }]);
  });

  it('saves the description through the ORM when creating an approver', async () => {
    const created = {
      ID: 'approver-id',
      APPROVER_ID: 123,
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Finance',
      ENABLED: true,
      employee: { NAME_ENG: 'Example Employee', INITIALS: 'EX', USERNAME: 'example', CURRENT_EMAIL: 'example@example.com' },
    };
    const create = jest.fn().mockResolvedValue(created);
    const findByPk = jest.fn().mockResolvedValue(created);
    const findOne = jest.fn().mockResolvedValue(null);
    getModels.mockReturnValue({
      Approver: { findOne, create, findByPk, sequelize: { fn: jest.fn().mockReturnValue('GETDATE()') } },
      ApproverType: { findOne: jest.fn().mockResolvedValue({ ID: 'type-id' }) },
      Employee: { findByPk: jest.fn().mockResolvedValue({ EMP_CODE: 123, NAME_ENG: 'Example Employee' }) },
    });

    const result = await approverService.createApprover('123', 'type-id', 'Finance', true, 789);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      NAME: 'Example Employee',
      APPROVER_ID: '123',
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Finance',
      ENABLED: true,
      SORTING: null,
      CREATED_DATE: 'GETDATE()',
      CREATED_BY: 789,
      UPDATED_DATE: 'GETDATE()',
      UPDATED_BY: 789,
    }));
    expect(result.item).toMatchObject({ DESCRIPTION: 'Finance', CODE: '123', ACTIVE: true });
  });

  it('updates approver details and soft-deletes through ORM associations', async () => {
    const updated = {
      ID: 'approver-id',
      APPROVER_ID: 123,
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Updated description',
      ENABLED: false,
      employee: { NAME_ENG: 'Example Employee', INITIALS: 'EX', USERNAME: 'example', CURRENT_EMAIL: 'example@example.com' },
    };
    const update = jest.fn().mockResolvedValue(updated);
    const approverFindByPk = jest.fn()
      .mockResolvedValueOnce({ update })
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(updated);
    const approverUpdate = jest.fn().mockResolvedValue([1]);
    getModels.mockReturnValue({
      Approver: {
        findByPk: approverFindByPk,
        findOne: jest.fn().mockResolvedValue(null),
        update: approverUpdate,
        sequelize: { fn: jest.fn().mockReturnValue('GETDATE()') },
      },
      ApproverType: { findOne: jest.fn().mockResolvedValue({ ID: 'type-id' }) },
      Employee: { findByPk: jest.fn().mockResolvedValue({ EMP_CODE: 123, NAME_ENG: 'Example Employee' }) },
    });

    const result = await approverService.updateApprover('approver-id', '123', 'type-id', 'Updated description', false, 789);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      NAME: 'Example Employee',
      APPROVER_ID: '123',
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Updated description',
      ENABLED: false,
      UPDATED_DATE: 'GETDATE()',
      UPDATED_BY: 789,
    }));
    expect(result.item).toMatchObject({ DESCRIPTION: 'Updated description', ACTIVE: false });

    const deleted = await approverService.softDelete('approver-id', 789);
    expect(approverUpdate).toHaveBeenCalledWith(
      { ENABLED: false, UPDATED_DATE: 'GETDATE()', UPDATED_BY: 789 },
      { where: { ID: 'approver-id' } },
    );
    expect(deleted.item).toMatchObject({ ID: 'approver-id', ACTIVE: false });
  });

  it('persists the active toggle as a bit value and returns the updated approver', async () => {
    const updated = {
      ID: 'approver-id',
      APPROVER_ID: 123,
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Finance',
      ENABLED: true,
      employee: { NAME_ENG: 'Example Employee', CURRENT_EMAIL: 'example@example.com' },
    };
    const update = jest.fn().mockResolvedValue([1]);
    const findByPk = jest.fn().mockResolvedValue(updated);
    getModels.mockReturnValue({
      Approver: { update, findByPk, sequelize: { fn: jest.fn().mockReturnValue('GETDATE()') } },
      ApproverType: {},
      Employee: {},
    });

    const result = await approverService.setActive('approver-id', true, 789);

    expect(update).toHaveBeenCalledWith(
      { ENABLED: true, UPDATED_DATE: 'GETDATE()', UPDATED_BY: 789 },
      { where: { ID: 'approver-id' } },
    );
    expect(result.item).toMatchObject({ ID: 'approver-id', ACTIVE: true });
  });
});
