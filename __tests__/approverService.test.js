/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));

const { getModels } = require('../models');
const { Op, cast, col, where } = require('sequelize');
const approverService = require('../services/approverService');

describe('approverService', () => {
  it.each([
    ['Name', 'Example Employee'],
    ['Employee Code', '20001234'],
    ['Email', 'employee@example.com'],
    ['Initials', 'EX'],
    ['Username', 'example'],
  ])('searches all five employee fields for %s input', async (field, value) => {
    const findAll = jest.fn().mockResolvedValue([]);
    getModels.mockReturnValue({ Employee: { findAll } });

    await approverService.listEmployeeOptions(`  ${value}  `);

    const options = findAll.mock.calls[0][0];
    expect(options.where.WORK_STATUS).toBeUndefined();
    expect(options.where[Op.and][0][Op.or]).toEqual([
      where(cast(col('EMP_CODE'), 'NVARCHAR'), { [Op.like]: `%${value}%` }),
      { NAME_ENG: { [Op.like]: `%${value}%` } },
      { INITIALS: { [Op.like]: `%${value}%` } },
      { USERNAME: { [Op.like]: `%${value}%` } },
      { CURRENT_EMAIL: { [Op.like]: `%${value}%` } },
    ]);
    expect(options.limit).toBe(100);
    expect(options.order).toEqual([['NAME_ENG', 'ASC'], ['EMP_CODE', 'ASC']]);
  });

  it('preserves employee option fields and skips the search filter for a blank query', async () => {
    const findAll = jest.fn().mockResolvedValue([{
      EMP_CODE: 20001234,
      NAME_ENG: 'Example Employee',
      INITIALS: 'EX',
      USERNAME: 'example',
      CURRENT_EMAIL: 'example@example.com',
    }]);
    getModels.mockReturnValue({ Employee: { findAll } });

    await expect(approverService.listEmployeeOptions('   ')).resolves.toEqual([{
      CODE: '20001234',
      NAME: 'Example Employee',
      USER: 'EX-example',
      EMAIL: 'example@example.com',
    }]);
    expect(findAll.mock.calls[0][0].where).toEqual({});
  });

  it('loads the list with joined employee fields, filters, stable sorting, and pagination through Sequelize', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({
      count: 1,
      rows: [{
        ID: 'approver-id',
        APPROVER_ID: 123,
        APPROVER_TYPE_ID: 'type-id',
        DESCRIPTION: 'Finance',
        PRIMARY: true,
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
      PRIMARY: 'primary',
    });

    expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        [Op.and]: expect.arrayContaining([{ PRIMARY: true, ENABLED: true }]),
      }),
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
        PRIMARY: true,
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
      PRIMARY: false,
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

  it('creates a primary approver after clearing the active type group in a transaction', async () => {
    const transaction = {
      finished: null,
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const created = {
      ID: 'approver-id',
      APPROVER_ID: 123,
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Finance',
      PRIMARY: true,
      ENABLED: true,
      employee: { NAME_ENG: 'Example Employee', CURRENT_EMAIL: 'example@example.com' },
      approverType: { NAME: 'Finance' },
    };
    const create = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue([1]);
    const findByPk = jest.fn().mockResolvedValue(created);
    const sequelize = {
      fn: jest.fn().mockReturnValue('GETDATE()'),
      transaction: jest.fn().mockResolvedValue(transaction),
    };
    getModels.mockReturnValue({
      Approver: { findOne: jest.fn().mockResolvedValue(null), create, update, findByPk, sequelize },
      ApproverType: { findOne: jest.fn().mockResolvedValue({ ID: 'type-id' }) },
      Employee: { findByPk: jest.fn().mockResolvedValue({ EMP_CODE: 123, NAME_ENG: 'Example Employee' }) },
    });

    const result = await approverService.createApprover('123', 'type-id', 'Finance', true, 789, true);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      APPROVER_TYPE_ID: 'type-id',
      PRIMARY: false,
      ENABLED: true,
    }), { transaction });
    expect(update).toHaveBeenNthCalledWith(1, { PRIMARY: false }, {
      where: { APPROVER_TYPE_ID: 'type-id', ENABLED: true },
      transaction,
    });
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      PRIMARY: true,
      UPDATED_BY: 789,
    }), {
      where: { ID: expect.any(String), APPROVER_TYPE_ID: 'type-id', ENABLED: true },
      transaction,
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(result.item).toMatchObject({ PRIMARY: true, ACTIVE: true });
  });

  it('updates approver details and soft-deletes through ORM associations', async () => {
    const updated = {
      ID: 'approver-id',
      APPROVER_ID: 123,
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Updated description',
      PRIMARY: true,
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
      PRIMARY: false,
      ENABLED: false,
      UPDATED_DATE: 'GETDATE()',
      UPDATED_BY: 789,
    }));
    expect(result.item).toMatchObject({ DESCRIPTION: 'Updated description', ACTIVE: false });

    const deleted = await approverService.softDelete('approver-id', 789);
    expect(approverUpdate).toHaveBeenCalledWith(
      { ENABLED: false, PRIMARY: false, UPDATED_DATE: 'GETDATE()', UPDATED_BY: 789 },
      { where: { ID: 'approver-id' } },
    );
    expect(deleted.item).toMatchObject({ ID: 'approver-id', ACTIVE: false });
  });

  it('updates an approver to primary while clearing the active members in its selected type', async () => {
    const transaction = {
      finished: null,
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const updated = {
      ID: 'approver-id',
      APPROVER_ID: 123,
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Finance',
      PRIMARY: true,
      ENABLED: true,
      employee: { NAME_ENG: 'Example Employee', CURRENT_EMAIL: 'example@example.com' },
      approverType: { NAME: 'Finance' },
    };
    const updateCurrent = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue([1]);
    const findByPk = jest.fn()
      .mockResolvedValueOnce({
        ID: 'approver-id',
        APPROVER_TYPE_ID: 'type-id',
        ENABLED: true,
        PRIMARY: false,
        update: updateCurrent,
      })
      .mockResolvedValueOnce(updated);
    const sequelize = {
      fn: jest.fn().mockReturnValue('GETDATE()'),
      transaction: jest.fn().mockResolvedValue(transaction),
    };
    getModels.mockReturnValue({
      Approver: { findByPk, findOne: jest.fn().mockResolvedValue(null), update, sequelize },
      ApproverType: { findOne: jest.fn().mockResolvedValue({ ID: 'type-id' }) },
      Employee: { findByPk: jest.fn().mockResolvedValue({ EMP_CODE: 123, NAME_ENG: 'Example Employee' }) },
    });

    const result = await approverService.updateApprover('approver-id', '123', 'type-id', 'Finance', true, 789, true);

    expect(updateCurrent).toHaveBeenCalledWith(expect.objectContaining({
      APPROVER_TYPE_ID: 'type-id',
      PRIMARY: false,
      ENABLED: true,
    }), { transaction });
    expect(update).toHaveBeenNthCalledWith(1, { PRIMARY: false }, {
      where: { APPROVER_TYPE_ID: 'type-id', ENABLED: true },
      transaction,
    });
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      PRIMARY: true,
      UPDATED_BY: 789,
    }), {
      where: { ID: 'approver-id', APPROVER_TYPE_ID: 'type-id', ENABLED: true },
      transaction,
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(result.item).toMatchObject({ PRIMARY: true, ACTIVE: true });
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
      { ENABLED: true, PRIMARY: false, UPDATED_DATE: 'GETDATE()', UPDATED_BY: 789 },
      { where: { ID: 'approver-id' } },
    );
    expect(result.item).toMatchObject({ ID: 'approver-id', ACTIVE: true });
  });

  it('sets the selected active approver as the only primary in its active type', async () => {
    const transaction = {
      LOCK: { UPDATE: 'UPDATE' },
      finished: null,
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const current = {
      ID: 'approver-id',
      APPROVER_TYPE_ID: 'type-id',
      ENABLED: true,
      update: jest.fn().mockResolvedValue(undefined),
    };
    const updated = {
      ID: 'approver-id',
      APPROVER_ID: 123,
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Finance',
      PRIMARY: true,
      ENABLED: true,
      employee: { NAME_ENG: 'Example Employee', CURRENT_EMAIL: 'example@example.com' },
      approverType: { NAME: 'Finance' },
    };
    const update = jest.fn().mockResolvedValue([1]);
    const findByPk = jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
    const sequelize = {
      fn: jest.fn().mockReturnValue('GETDATE()'),
      transaction: jest.fn().mockResolvedValue(transaction),
    };
    getModels.mockReturnValue({
      Approver: { findByPk, update, sequelize },
      ApproverType: {},
      Employee: {},
    });

    const result = await approverService.setPrimary('approver-id', 789);

    expect(findByPk).toHaveBeenNthCalledWith(1, 'approver-id', { transaction });
    expect(update).toHaveBeenNthCalledWith(1,
      { PRIMARY: false },
      { where: { APPROVER_TYPE_ID: 'type-id', ENABLED: true }, transaction },
    );
    expect(update).toHaveBeenNthCalledWith(2,
      { PRIMARY: true, UPDATED_DATE: 'GETDATE()', UPDATED_BY: 789 },
      { where: { ID: 'approver-id', APPROVER_TYPE_ID: 'type-id', ENABLED: true }, transaction },
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(result.item).toMatchObject({ ID: 'approver-id', PRIMARY: true });
  });

  it('does not set an inactive approver as primary', async () => {
    const transaction = {
      LOCK: { UPDATE: 'UPDATE' },
      finished: null,
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const update = jest.fn();
    getModels.mockReturnValue({
      Approver: {
        findByPk: jest.fn().mockResolvedValue({
          ID: 'approver-id',
          APPROVER_TYPE_ID: 'type-id',
          ENABLED: false,
        }),
        update,
        sequelize: { transaction: jest.fn().mockResolvedValue(transaction) },
      },
    });

    await expect(approverService.setPrimary('approver-id', 789)).resolves.toEqual({ kind: 'inactive' });
    expect(update).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('clears primary only from the selected active approver when switched off', async () => {
    const transaction = {
      finished: null,
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const current = {
      ID: 'approver-id',
      APPROVER_TYPE_ID: 'type-id',
      ENABLED: true,
    };
    const updated = {
      ID: 'approver-id',
      APPROVER_ID: 123,
      APPROVER_TYPE_ID: 'type-id',
      DESCRIPTION: 'Finance',
      PRIMARY: false,
      ENABLED: true,
      employee: { NAME_ENG: 'Example Employee', CURRENT_EMAIL: 'example@example.com' },
      approverType: { NAME: 'Finance' },
    };
    const update = jest.fn().mockResolvedValue([1]);
    const findByPk = jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
    const sequelize = {
      fn: jest.fn().mockReturnValue('GETDATE()'),
      transaction: jest.fn().mockResolvedValue(transaction),
    };
    getModels.mockReturnValue({ Approver: { findByPk, update, sequelize }, ApproverType: {}, Employee: {} });

    const result = await approverService.setPrimary('approver-id', 789, false);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      PRIMARY: false,
      UPDATED_BY: 789,
    }), {
      where: { ID: 'approver-id', APPROVER_TYPE_ID: 'type-id', ENABLED: true },
      transaction,
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(result.item).toMatchObject({ ID: 'approver-id', PRIMARY: false });
  });
});
