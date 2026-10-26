const { randomUUID } = require('crypto');
const { Op, cast, col, fn, where } = require('sequelize');
const { getModels } = require('../models');

const SORT_FIELDS = {
  CODE: 'APPROVER_ID',
  NAME: 'NAME_ENG',
  APPROVER_TYPE: 'NAME',
  DESCRIPTION: 'DESCRIPTION',
  EMAIL: 'CURRENT_EMAIL',
  PRIMARY: 'PRIMARY',
  UPDATED_DATE: 'UPDATED_DATE',
  ACTIVE: 'ENABLED',
};
const APPROVER_NAME_MAX_LENGTH = 50;

function normalizePage(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isEnabled(value) {
  return value === true || value === 1 || value === '1';
}

function formatEmployeeName(employee) {
  return employee
    ? `${employee.INITIALS || ''}-${employee.USERNAME || ''}`.replace(/^-|-$/g, '')
    : '';
}

function formatUpdatedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('day')} ${part('month')} ${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`;
}

function mapApprover(approver) {
  return {
    ID: String(approver.ID),
    CODE: approver.APPROVER_ID == null ? '' : String(approver.APPROVER_ID),
    APPROVER_TYPE_ID: String(approver.APPROVER_TYPE_ID),
    APPROVER_TYPE: approver.approverType?.NAME || '',
    NAME: approver.employee?.NAME_ENG || '',
    DESCRIPTION: approver.DESCRIPTION || '',
    EMAIL: (approver.employee?.CURRENT_EMAIL || '').toLowerCase(),
    UPDATED_DATE: formatUpdatedDate(approver.UPDATED_DATE),
    UPDATED_BY: formatEmployeeName(approver.updatedByEmployee),
    ACTIVE: isEnabled(approver.ENABLED),
    PRIMARY: isEnabled(approver.ENABLED) && isEnabled(approver.PRIMARY),
  };
}

function buildApproverWhere(query) {
  const filters = [];
  const code = typeof query.CODE === 'string' ? query.CODE.trim() : '';
  const description = typeof query.DESCRIPTION === 'string' ? query.DESCRIPTION.trim() : '';
  const updatedBy = typeof query.UPDATED_BY === 'string' ? query.UPDATED_BY.trim() : '';
  const updatedDate = typeof query.UPDATED_DATE === 'string' ? query.UPDATED_DATE.trim() : '';
  const active = typeof query.ACTIVE === 'string' ? query.ACTIVE.trim().toLowerCase() : '';
  const primary = typeof query.PRIMARY === 'string' ? query.PRIMARY.trim().toLowerCase() : '';

  if (code) filters.push(where(cast(col('APPROVER_ID'), 'NVARCHAR'), { [Op.like]: `%${code}%` }));
  if (description) filters.push({ DESCRIPTION: { [Op.like]: `%${description}%` } });
  if (updatedBy) filters.push(where(fn('CONCAT', col('updatedByEmployee.INITIALS'), '-', col('updatedByEmployee.USERNAME')), { [Op.like]: `%${updatedBy}%` }));
  if (/^\d{4}-\d{2}-\d{2}$/.test(updatedDate)) {
    const start = new Date(`${updatedDate}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      filters.push({ UPDATED_DATE: { [Op.gte]: start, [Op.lt]: end } });
    }
  }
  if (active === 'active' || active === 'true') filters.push({ ENABLED: true });
  if (active === 'inactive' || active === 'false') filters.push({ ENABLED: false });
  if (primary === 'primary' || primary === 'true' || primary === '1') filters.push({ PRIMARY: true, ENABLED: true });
  if (primary === 'not primary' || primary === 'false' || primary === '0') filters.push({ PRIMARY: false });

  return filters.length ? { [Op.and]: filters } : undefined;
}

function buildEmployeeWhere(query) {
  const filters = [];
  const name = typeof query.NAME === 'string' ? query.NAME.trim() : '';
  const email = typeof query.EMAIL === 'string' ? query.EMAIL.trim() : '';

  if (name) filters.push({ NAME_ENG: { [Op.like]: `%${name}%` } });
  if (email) filters.push({ CURRENT_EMAIL: { [Op.like]: `%${email}%` } });

  return filters.length ? { [Op.and]: filters } : undefined;
}

function buildApproverTypeWhere(query) {
  const approverType = typeof query.APPROVER_TYPE === 'string' ? query.APPROVER_TYPE.trim() : '';
  return approverType ? { NAME: { [Op.like]: `%${approverType}%` } } : undefined;
}

function buildOrder(sort, dir, Employee, ApproverType) {
  const direction = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const field = SORT_FIELDS[sort];
  if (field === 'NAME_ENG' || field === 'CURRENT_EMAIL') {
    return [[{ model: Employee, as: 'employee' }, field, direction], ['ID', 'ASC']];
  }
  if (sort === 'APPROVER_TYPE') {
    return [[{ model: ApproverType, as: 'approverType' }, 'NAME', direction], ['APPROVER_ID', 'ASC'], ['ID', 'ASC']];
  }
  if (sort === 'UPDATED_BY') {
    return [[{ model: Employee, as: 'updatedByEmployee' }, 'INITIALS', direction],
      [{ model: Employee, as: 'updatedByEmployee' }, 'USERNAME', direction], ['ID', 'ASC']];
  }
  return field === 'APPROVER_ID'
    ? [[field, direction], ['ID', 'ASC']]
    : [[field || SORT_FIELDS.CODE, direction], ['APPROVER_ID', 'ASC'], ['ID', 'ASC']];
}

async function listApprovers(query = {}) {
  const { Approver, ApproverType, Employee } = getModels();
  const page = normalizePage(query.page, 1);
  const pageSize = Math.min(normalizePage(query.pageSize, 25), 100);
  const employeeWhere = buildEmployeeWhere(query);
  const approverTypeWhere = buildApproverTypeWhere(query);
  const result = await Approver.findAndCountAll({
    where: buildApproverWhere(query),
    include: [
      {
        model: Employee,
        as: 'employee',
        attributes: ['EMP_CODE', 'NAME_ENG', 'INITIALS', 'USERNAME', 'CURRENT_EMAIL'],
        required: Boolean(employeeWhere),
        where: employeeWhere,
      },
      {
        model: ApproverType,
        as: 'approverType',
        attributes: ['NAME'],
        required: Boolean(approverTypeWhere),
        where: approverTypeWhere,
      },
      {
        model: Employee,
        as: 'updatedByEmployee',
        attributes: ['EMP_CODE', 'INITIALS', 'USERNAME'],
        required: Boolean(query.UPDATED_BY),
      },
    ],
    distinct: true,
    order: buildOrder(query.sort, query.dir, Employee, ApproverType),
    offset: (page - 1) * pageSize,
    limit: pageSize,
    attributes: ['ID', 'APPROVER_ID', 'APPROVER_TYPE_ID', 'NAME', 'DESCRIPTION', 'PRIMARY', 'ENABLED', 'UPDATED_DATE', 'UPDATED_BY'],
  });
  const totalItems = Number(result.count);

  return {
    items: result.rows.map(mapApprover),
    pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
  };
}

async function listEmployeeOptions(search = '') {
  const { Employee } = getModels();
  const value = typeof search === 'string' ? search.trim() : '';
  const whereClause = {};
  if (value) {
    whereClause[Op.and] = [{
      [Op.or]: [
        where(cast(col('EMP_CODE'), 'NVARCHAR'), { [Op.like]: `%${value}%` }),
        { NAME_ENG: { [Op.like]: `%${value}%` } },
        { INITIALS: { [Op.like]: `%${value}%` } },
        { USERNAME: { [Op.like]: `%${value}%` } },
        { CURRENT_EMAIL: { [Op.like]: `%${value}%` } },
      ],
    }];
  }
  const employees = await Employee.findAll({
    attributes: ['EMP_CODE', 'NAME_ENG', 'INITIALS', 'USERNAME', 'CURRENT_EMAIL'],
    where: whereClause,
    order: [['NAME_ENG', 'ASC'], ['EMP_CODE', 'ASC']],
    limit: 100,
  });
  return employees.map((employee) => ({
    CODE: String(employee.EMP_CODE),
    NAME: employee.NAME_ENG || '',
    USER: formatEmployeeName(employee),
    EMAIL: employee.CURRENT_EMAIL || '',
  }));
}

async function listApproverTypeOptions() {
  const { ApproverType } = getModels();
  const types = await ApproverType.findAll({
    attributes: ['ID', 'NAME'],
    where: { ENABLED: true },
    order: [['SORTING', 'ASC'], ['ID', 'ASC']],
  });
  return types.map((type) => ({ ID: String(type.ID), NAME: type.NAME }));
}

async function findApprover(id) {
  const { Approver } = getModels();
  return Approver.findByPk(id);
}

async function findEmployee(employeeCode) {
  const { Employee } = getModels();
  return Employee.findByPk(employeeCode);
}

async function isActiveApproverType(approverTypeId) {
  const { ApproverType } = getModels();
  return Boolean(await ApproverType.findOne({
    where: { ID: approverTypeId, ENABLED: true },
    attributes: ['ID'],
  }));
}

function validateApproverName(employee) {
  const name = employee.NAME_ENG || '';
  return name.length <= APPROVER_NAME_MAX_LENGTH ? { name } : { kind: 'employee-name-too-long' };
}

async function setPrimaryInType(Approver, id, approverTypeId, actorCode, transaction) {
  await Approver.update(
    { PRIMARY: false },
    { where: { APPROVER_TYPE_ID: approverTypeId, ENABLED: true }, transaction },
  );
  const [affectedCount] = await Approver.update(
    {
      PRIMARY: true,
      UPDATED_DATE: Approver.sequelize.fn('GETDATE'),
      UPDATED_BY: actorCode,
    },
    {
      where: { ID: id, APPROVER_TYPE_ID: approverTypeId, ENABLED: true },
      transaction,
    },
  );
  return affectedCount > 0;
}

async function createApprover(employeeCode, approverTypeId, description, enabled, actorCode, primary = false) {
  const { Approver } = getModels();
  const employee = await findEmployee(employeeCode);
  if (!employee) return { kind: 'employee-not-found' };
  const name = validateApproverName(employee);
  if (name.kind) return name;
  if (!(await isActiveApproverType(approverTypeId))) return { kind: 'approver-type-not-found' };

  const existing = await Approver.findOne({
    where: { APPROVER_ID: employeeCode, ENABLED: true },
    attributes: ['ID'],
  });
  if (existing) return { kind: 'duplicate' };

  const id = randomUUID();
  const values = {
    ID: id,
    NAME: name.name,
    APPROVER_ID: employeeCode,
    APPROVER_TYPE_ID: approverTypeId,
    DESCRIPTION: description,
    PRIMARY: false,
    ENABLED: enabled,
    SORTING: null,
    CREATED_DATE: Approver.sequelize.fn('GETDATE'),
    CREATED_BY: actorCode,
    UPDATED_DATE: Approver.sequelize.fn('GETDATE'),
    UPDATED_BY: actorCode,
  };
  if (enabled && primary) {
    const transaction = await Approver.sequelize.transaction();
    try {
      await Approver.create(values, { transaction });
      const selected = await setPrimaryInType(Approver, id, approverTypeId, actorCode, transaction);
      if (!selected) {
        await transaction.rollback();
        return { kind: 'inactive' };
      }
      await transaction.commit();
    } catch (error) {
      if (!transaction.finished) await transaction.rollback();
      throw error;
    }
  } else {
    await Approver.create(values);
  }
  return { item: await getApproverById(id) };
}

async function getApproverById(id) {
  const { Approver, ApproverType, Employee } = getModels();
  const approver = await Approver.findByPk(id, {
    include: [
      {
        model: Employee,
        as: 'employee',
        attributes: ['EMP_CODE', 'NAME_ENG', 'INITIALS', 'USERNAME', 'CURRENT_EMAIL'],
        required: false,
      },
      {
        model: Employee,
        as: 'updatedByEmployee',
        attributes: ['EMP_CODE', 'INITIALS', 'USERNAME'],
        required: false,
      },
      {
        model: ApproverType,
        as: 'approverType',
        attributes: ['NAME'],
        required: false,
      },
    ],
  });
  return approver ? mapApprover(approver) : null;
}

async function updateApprover(id, employeeCode, approverTypeId, description, enabled, actorCode, primary) {
  const { Approver } = getModels();
  const employee = await findEmployee(employeeCode);
  if (!employee) return { kind: 'employee-not-found' };
  const name = validateApproverName(employee);
  if (name.kind) return name;
  if (!(await isActiveApproverType(approverTypeId))) return { kind: 'approver-type-not-found' };
  const current = await findApprover(id);
  if (!current) return { kind: 'not-found' };

  const duplicate = await Approver.findOne({
    where: { APPROVER_ID: employeeCode, ENABLED: true, ID: { [Op.ne]: id } },
    attributes: ['ID'],
  });
  if (duplicate) return { kind: 'duplicate' };

  const preservePrimary = primary === undefined && enabled
    && isEnabled(current.ENABLED)
    && isEnabled(current.PRIMARY)
    && String(current.APPROVER_TYPE_ID) === String(approverTypeId);
  const shouldBePrimary = enabled && (primary === true || preservePrimary);
  const values = {
    NAME: name.name,
    APPROVER_ID: employeeCode,
    APPROVER_TYPE_ID: approverTypeId,
    DESCRIPTION: description,
    PRIMARY: false,
    ENABLED: enabled,
    UPDATED_DATE: Approver.sequelize.fn('GETDATE'),
    UPDATED_BY: actorCode,
  };
  if (shouldBePrimary) {
    const transaction = await Approver.sequelize.transaction();
    try {
      await current.update(values, { transaction });
      const selected = await setPrimaryInType(Approver, id, approverTypeId, actorCode, transaction);
      if (!selected) {
        await transaction.rollback();
        return { kind: 'inactive' };
      }
      await transaction.commit();
    } catch (error) {
      if (!transaction.finished) await transaction.rollback();
      throw error;
    }
  } else {
    await current.update(values);
  }
  return { item: await getApproverById(id) };
}

async function setActive(id, enabled, actorCode) {
  const { Approver } = getModels();
  const [affectedCount] = await Approver.update(
    {
      ENABLED: enabled,
      PRIMARY: false,
      UPDATED_DATE: Approver.sequelize.fn('GETDATE'),
      UPDATED_BY: actorCode,
    },
    { where: { ID: id } },
  );
  return affectedCount > 0 ? { item: await getApproverById(id) } : { kind: 'not-found' };
}

async function setPrimary(id, actorCode, primary = true) {
  const { Approver } = getModels();
  const transaction = await Approver.sequelize.transaction();
  try {
    const current = await Approver.findByPk(id, { transaction });
    if (!current) {
      await transaction.rollback();
      return { kind: 'not-found' };
    }
    if (!isEnabled(current.ENABLED)) {
      await transaction.rollback();
      return { kind: 'inactive' };
    }

    let updated;
    if (primary) {
      updated = await setPrimaryInType(
        Approver,
        id,
        current.APPROVER_TYPE_ID,
        actorCode,
        transaction,
      );
    } else {
      const [affectedCount] = await Approver.update(
        {
          PRIMARY: false,
          UPDATED_DATE: Approver.sequelize.fn('GETDATE'),
          UPDATED_BY: actorCode,
        },
        {
          where: { ID: id, APPROVER_TYPE_ID: current.APPROVER_TYPE_ID, ENABLED: true },
          transaction,
        },
      );
      updated = affectedCount > 0;
    }
    if (!updated) {
      await transaction.rollback();
      return { kind: 'inactive' };
    }
    await transaction.commit();
    return { item: await getApproverById(id) };
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function softDelete(id, actorCode) {
  return setActive(id, false, actorCode);
}

module.exports = {
  listApprovers,
  listEmployeeOptions,
  listApproverTypeOptions,
  createApprover,
  getApproverById,
  updateApprover,
  setActive,
  setPrimary,
  softDelete,
};
