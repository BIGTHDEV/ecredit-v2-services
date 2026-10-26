const { Op, fn, QueryTypes } = require('sequelize');
const { getDatabase } = require('../config/database');
const { getModels } = require('../models');
const {
  getPresenceStatus,
  getPresenceUserCodesByStatus,
  getTrackedPresenceUserCodes,
} = require('./sessionPresenceService');

const SORT_FIELDS = {
  CODE: 'EMP_CODE',
  NAME: 'NAME_ENG',
  USER: 'USERNAME',
  EMAIL: 'CURRENT_EMAIL',
  COST_CENTER_DESC: 'costCenter.COST_CENTER_DESC',
  BU: 'costCenter.BU',
  DEPARTMENT: 'costCenter.DEPARTMENT',
  MANAGER_1: 'manager1.USERNAME',
  MANAGER_2: 'manager2.USERNAME',
  UPDATED_DATE: 'user.UPDATED_DATE',
  UPDATED_BY: 'updatedByEmployee.INITIALS',
  SYSTEM_ACTIVE: 'user.ENABLED',
};

function normalizePage(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function employeeIdentityFilter(value, association = '') {
  const pattern = `%${value.trim()}%`;
  const initials = association
    ? { [`$${association}.INITIALS$`]: { [Op.like]: pattern } }
    : { INITIALS: { [Op.like]: pattern } };
  const username = association
    ? { [`$${association}.USERNAME$`]: { [Op.like]: pattern } }
    : { USERNAME: { [Op.like]: pattern } };
  return { [Op.or]: [initials, username] };
}

function buildWhere(query) {
  const filters = [];
  const fields = {
    CODE: 'EMP_CODE',
    NAME: 'NAME_ENG',
    EMAIL: 'CURRENT_EMAIL',
  };

  for (const [key, column] of Object.entries(fields)) {
    if (query[key]?.trim()) {
      filters.push({ [column]: { [Op.like]: `%${query[key].trim()}%` } });
    }
  }

  const user = query.USER?.trim();
  if (user) filters.push(employeeIdentityFilter(user));

  for (const [key, association] of [['MANAGER_1', 'manager1'], ['MANAGER_2', 'manager2']]) {
    const value = query[key]?.trim();
    if (value) filters.push(employeeIdentityFilter(value, association));
  }

  const updatedBy = query.UPDATED_BY?.trim();
  if (updatedBy) {
    filters.push(employeeIdentityFilter(updatedBy, 'user.updatedByEmployee'));
  }

  const updatedDate = query.UPDATED_DATE?.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(updatedDate || '')) {
    const start = new Date(`${updatedDate}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) {
      filters.push({ '$user.UPDATED_DATE$': { [Op.gte]: start, [Op.lt]: new Date(start.getTime() + 24 * 60 * 60 * 1000) } });
    }
  }

  const presenceStatus = String(query.PRESENCE_STATUS || '').trim().toUpperCase();
  if (presenceStatus === 'ACTIVE' || presenceStatus === 'AWAY') {
    filters.push({ EMP_CODE: { [Op.in]: getPresenceUserCodesByStatus(presenceStatus) } });
  } else if (presenceStatus === 'OFFLINE') {
    const trackedUserCodes = getTrackedPresenceUserCodes();
    if (trackedUserCodes.length) filters.push({ EMP_CODE: { [Op.notIn]: trackedUserCodes } });
  }

  return filters.length ? { [Op.and]: filters } : undefined;
}

function buildOrder(sort, dir, models) {
  const direction = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const field = SORT_FIELDS[sort] || 'EMP_CODE';
  if (field === 'user.ENABLED') {
    return [[{ model: models.User, as: 'user' }, 'ENABLED', direction], ['EMP_CODE', 'ASC']];
  }
  if (field === 'user.UPDATED_DATE') {
    return [[{ model: models.User, as: 'user' }, 'UPDATED_DATE', direction], ['EMP_CODE', 'ASC']];
  }
  if (field === 'updatedByEmployee.INITIALS') {
    return [
      [{ model: models.User, as: 'user' }, { model: models.Employee, as: 'updatedByEmployee' }, 'INITIALS', direction],
      [{ model: models.User, as: 'user' }, { model: models.Employee, as: 'updatedByEmployee' }, 'USERNAME', direction],
      ['EMP_CODE', 'ASC'],
    ];
  }
  if (field.startsWith('costCenter.')) {
    return [[{ model: models.User, as: 'user' }, { model: models.CostCenterMapping, as: 'costCenter' }, field.split('.')[1], direction], ['EMP_CODE', 'ASC']];
  }
  if (field.startsWith('manager')) {
    const [association, column] = field.split('.');
    return [[{ model: models.Employee, as: association }, column, direction], ['EMP_CODE', 'ASC']];
  }
  return field === 'EMP_CODE'
    ? [[field, direction]]
    : [[field, direction], ['EMP_CODE', 'ASC']];
}

function formatUserName(employee) {
  return employee ? `${employee.INITIALS || ''}-${employee.USERNAME || ''}`.replace(/^-|-$/g, '') : '';
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

function isEnabled(value) {
  return value === true || value === 1 || value === '1';
}

function byRoleLevel(a, b) {
  const level = (userRole) => Number(userRole.role?.LEVEL ?? Number.MAX_SAFE_INTEGER);
  return level(a) - level(b) || String(a.role?.NAME || '').localeCompare(String(b.role?.NAME || ''));
}

function mapUser(employee) {
  const user = employee.user;
  const costCenter = user?.costCenter;
  const roles = [...(user?.userRoles || [])]
    .filter((userRole) => isEnabled(userRole.ENABLED))
    .sort(byRoleLevel)
    .map((userRole) => userRole.role.NAME)
    .filter(Boolean);

  return {
    CODE: employee.EMP_CODE,
    NAME: employee.NAME_ENG || '',
    USER: formatUserName(employee),
    EMAIL: (employee.CURRENT_EMAIL || '').toLowerCase(),
    COST_CENTER_DESC: costCenter?.COST_CENTER_DESC || '',
    BU: costCenter?.BU || '',
    DEPARTMENT: costCenter?.DEPARTMENT || '',
    MANAGER_1: formatUserName(employee.manager1),
    MANAGER_2: formatUserName(employee.manager2),
    ROLES: [...new Set(roles)].join(', '),
    PRESENCE_STATUS: getPresenceStatus(employee.EMP_CODE),
    UPDATED_DATE: formatUpdatedDate(user?.UPDATED_DATE),
    UPDATED_BY: formatUserName(user?.updatedByEmployee),
    SYSTEM_ACTIVE: isEnabled(user?.ENABLED),
  };
}

function mapUserDetail(employee) {
  const user = employee.user;
  const costCenter = user?.costCenter;
  const activeUserRoles = [...(user?.userRoles || [])]
    .filter((userRole) => isEnabled(userRole.ENABLED) && isEnabled(userRole.role?.ENABLED))
    .sort(byRoleLevel);
  const roles = activeUserRoles
    .map((userRole) => userRole.role.NAME)
    .filter(Boolean);

  return {
    CODE: employee.EMP_CODE,
    ROLE: roles[0] || null,
    ROLES: [...new Set(roles)],
    ROLE_IDS: [...new Set(activeUserRoles.map((userRole) => String(userRole.ROLE_ID)))],
    BU: costCenter?.BU || '',
    DEPARTMENT: costCenter?.DEPARTMENT || '',
    USERNAME: employee.USERNAME || '',
    INITIALS: employee.INITIALS || '',
    FULL_NAME: employee.NAME_ENG || '',
    EMAIL: (employee.CURRENT_EMAIL || '').toLowerCase(),
    CODE_MANAGER_1: employee.manager1?.EMP_CODE || null,
    USERNAME_MANAGER_1: employee.manager1?.USERNAME || '',
    CODE_MANAGER_2: employee.manager2?.EMP_CODE || null,
    USERNAME_MANAGER_2: employee.manager2?.USERNAME || '',
    SYSTEM_ACTIVE: isEnabled(user?.ENABLED),
  };
}

async function listUsers(query) {
  const models = getModels();
  const { Employee, User, CostCenterMapping, UserRole, Role } = models;
  const page = normalizePage(query.page, 1);
  const pageSize = Math.min(normalizePage(query.pageSize, 25), 100);
  const result = await Employee.findAndCountAll({
    where: buildWhere(query),
    include: [
      { model: User, as: 'user', required: true, include: [
        { model: CostCenterMapping, as: 'costCenter', required: false },
        { model: UserRole, as: 'userRoles', required: false, include: [{ model: Role, as: 'role', required: false }] },
        { model: Employee, as: 'updatedByEmployee', required: false, attributes: ['EMP_CODE', 'INITIALS', 'USERNAME'] },
      ] },
      { model: Employee, as: 'manager1', required: false },
      { model: Employee, as: 'manager2', required: false },
    ],
    distinct: true,
    order: buildOrder(query.sort, query.dir, models),
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });

  return {
    items: result.rows.map(mapUser),
    pagination: {
      page,
      pageSize,
      totalItems: result.count,
      totalPages: Math.max(1, Math.ceil(result.count / pageSize)),
    },
  };
}

async function getUserDetail(code) {
  const { Employee, User, CostCenterMapping, UserRole, Role } = getModels();
  const employee = await Employee.findOne({
    where: { EMP_CODE: code },
    include: [
      { model: User, as: 'user', required: true, include: [
        { model: CostCenterMapping, as: 'costCenter', required: false },
        { model: UserRole, as: 'userRoles', required: false, include: [{ model: Role, as: 'role', required: false }] },
      ] },
      { model: Employee, as: 'manager1', required: false },
      { model: Employee, as: 'manager2', required: false },
    ],
  });

  return employee ? mapUserDetail(employee) : null;
}

async function setSystemActive(code, enabled, updatedBy) {
  const { User } = getModels();
  const [affectedRows] = await User.update(
    { ENABLED: enabled, UPDATED_DATE: fn('GETDATE'), UPDATED_BY: updatedBy },
    { where: { ID: code } },
  );
  return affectedRows > 0;
}

async function setViewAs(actorCode, targetCode) {
  const { User, Employee } = getModels();
  if (actorCode === targetCode) {
    const error = new Error('You cannot view as yourself.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const target = await Employee.findByPk(targetCode);
  if (!target) {
    const error = new Error(`Employee ${targetCode} was not found.`);
    error.statusCode = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    throw error;
  }
  await User.update(
    { VIEW_AS: targetCode, UPDATED_DATE: fn('GETDATE'), UPDATED_BY: actorCode },
    { where: { ID: actorCode } },
  );
}

async function clearViewAs(actorCode) {
  const { User } = getModels();
  await User.update(
    { VIEW_AS: null, UPDATED_DATE: fn('GETDATE'), UPDATED_BY: actorCode },
    { where: { ID: actorCode } },
  );
}

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function listAvailableEmployees(search = '') {
  const value = typeof search === 'string' ? search.trim() : '';
  const { Employee, User } = getModels();
  const where = { '$user.ID$': { [Op.is]: null } };
  if (value) {
    where[Op.or] = ['NAME_ENG', 'EMP_CODE', 'CURRENT_EMAIL', 'INITIALS', 'USERNAME']
      .map((field) => ({ [field]: { [Op.like]: `%${value}%` } }));
  }
  const rows = await Employee.findAll({
    attributes: ['EMP_CODE', 'NAME_ENG', 'INITIALS', 'USERNAME', 'CURRENT_EMAIL'],
    include: [{ model: User, as: 'user', required: false, attributes: [] }],
    where,
    order: [['NAME_ENG', 'ASC'], ['EMP_CODE', 'ASC']],
    limit: 100,
    raw: true,
  });
  return rows.map((row) => ({
    CODE: String(row.EMP_CODE),
    NAME: row.NAME_ENG || '',
    USER: `${row.INITIALS || ''}-${row.USERNAME || ''}`,
    EMAIL: (row.CURRENT_EMAIL || '').toLowerCase(),
  }));
}

async function listRoleOptions() {
  const { Role, RolePermission } = getModels();
  const [roles, links] = await Promise.all([
    Role.findAll({ where: { ENABLED: { [Op.in]: ['1', 1, true] } }, order: [['LEVEL', 'ASC'], ['NAME', 'ASC']] }),
    RolePermission.findAll({ where: { ENABLED: '1' }, attributes: ['ROLE_ID', 'PERMISSION_ID'], raw: true }),
  ]);
  return roles.map((role) => ({
    ID: String(role.ID),
    NAME: role.NAME,
    LEVEL: Number(role.LEVEL),
    PERMISSION_IDS: [...new Set(links.filter((link) => String(link.ROLE_ID) === String(role.ID)).map((link) => String(link.PERMISSION_ID)))],
  }));
}

async function listPermissionOptions() {
  const { Permission } = getModels();
  const permissions = await Permission.findAll({ where: { ENABLED: '1' }, order: [['SORTING', 'ASC'], ['NAME', 'ASC']] });
  return permissions.map((permission) => ({ ID: String(permission.ID), NAME: permission.NAME }));
}

async function resolveAccessSelection(roleIds, permissionIds) {
  const { Role, RolePermission, Permission } = getModels();
  const uniqueRoleIds = [...new Set(roleIds.map(String))];
  const roles = await Role.findAll({ where: { ID: { [Op.in]: uniqueRoleIds } } });
  const activeRoleIds = new Set(roles.filter((role) => isEnabled(role.ENABLED)).map((role) => String(role.ID)));
  if (uniqueRoleIds.some((roleId) => !activeRoleIds.has(roleId))) {
    throw serviceError('One or more selected roles were not found or are disabled.', 400, 'VALIDATION_ERROR');
  }
  const rolePermissions = await RolePermission.findAll({
    where: { ROLE_ID: { [Op.in]: uniqueRoleIds }, ENABLED: '1' },
    attributes: ['PERMISSION_ID'],
    raw: true,
  });
  const defaultPermissionIds = new Set(rolePermissions.map((permission) => String(permission.PERMISSION_ID)));
  const selectedPermissionIds = new Set(permissionIds.map(String));
  if ([...selectedPermissionIds].some((permissionId) => !defaultPermissionIds.has(permissionId))) {
    throw serviceError('Selected permissions must be included in the defaults of the assigned roles.', 400, 'VALIDATION_ERROR');
  }
  const activePermissions = await Permission.findAll({
    where: { ENABLED: '1' },
    attributes: ['ID'],
    raw: true,
  });
  const activePermissionIds = new Set(activePermissions.map((permission) => String(permission.ID)));
  if ([...selectedPermissionIds].some((permissionId) => !activePermissionIds.has(permissionId))) {
    throw serviceError('One or more selected permissions were not found or are disabled.', 400, 'VALIDATION_ERROR');
  }
  return { uniqueRoleIds, selectedPermissionIds, activePermissionIds };
}

async function getActorHighestPrivilegeLevel(actorCode) {
  const { UserRole, Role } = getModels();
  const actorRoles = await UserRole.findAll({
    where: { USER_ID: actorCode, ENABLED: { [Op.in]: ['1', 1, true] } },
    include: [{ model: Role, as: 'role', attributes: ['LEVEL'], required: true }],
  });
  const actorLevels = actorRoles
    .map((userRole) => Number(userRole.role?.LEVEL))
    .filter(Number.isFinite);
  if (!actorLevels.length) throw serviceError('Unable to verify the current user role level.', 403, 'FORBIDDEN');
  return Math.max(...actorLevels);
}

async function assertUserRoleLevelAllowed(actorCode, targetCode) {
  const { UserRole, Role } = getModels();
  const actorLevel = await getActorHighestPrivilegeLevel(actorCode);
  const targetRoles = await UserRole.findAll({
    where: { USER_ID: targetCode, ENABLED: { [Op.in]: ['1', 1, true] } },
    include: [{ model: Role, as: 'role', attributes: ['LEVEL'], required: true }],
  });
  if (targetRoles.some((userRole) => !Number.isFinite(Number(userRole.role?.LEVEL)) || Number(userRole.role.LEVEL) > actorLevel)) {
    throw serviceError('You cannot manage a user with a higher-level role.', 403, 'FORBIDDEN');
  }
}

async function assertRoleAssignmentAllowed(actorCode, roleIds) {
  const { Role } = getModels();
  const actorLevel = await getActorHighestPrivilegeLevel(actorCode);

  const uniqueRoleIds = [...new Set(roleIds.map(String))];
  const selectedRoles = await Role.findAll({
    where: { ID: { [Op.in]: uniqueRoleIds } },
    attributes: ['ID', 'LEVEL'],
  });
  if (selectedRoles.length !== uniqueRoleIds.length
      || selectedRoles.some((role) => !Number.isFinite(Number(role.LEVEL)) || Number(role.LEVEL) > actorLevel)) {
    throw serviceError('You can only assign roles at your level or below.', 403, 'FORBIDDEN');
  }
}

async function createUser(employeeCode, roleIds, permissionIds, enabled, actorCode) {
  const { Employee, User, UserPermission } = getModels();
  if (!(await Employee.findByPk(employeeCode))) throw serviceError('The selected employee was not found.', 400, 'VALIDATION_ERROR');
  if (await User.findByPk(employeeCode)) throw serviceError('This employee is already a user.', 409, 'DUPLICATE_USER');
  await assertRoleAssignmentAllowed(actorCode, roleIds);
  const { uniqueRoleIds, selectedPermissionIds, activePermissionIds } = await resolveAccessSelection(roleIds, permissionIds);

  const database = getDatabase();
  await database.transaction(async (transaction) => {
    await database.query(
      `INSERT INTO USER_SETTINGS (ID, ENABLED, CREATED_DATE, CREATED_BY, UPDATED_DATE, UPDATED_BY)
       VALUES (:employeeCode, :enabled, GETDATE(), :actorCode, GETDATE(), :actorCode)`,
      { replacements: { employeeCode, enabled: enabled ? '1' : '0', actorCode }, type: QueryTypes.INSERT, transaction },
    );
    await database.query(
      `INSERT INTO USERS (ID, ENABLED, CREATED_DATE, CREATED_BY, UPDATED_DATE, UPDATED_BY)
       VALUES (:employeeCode, :enabled, GETDATE(), :actorCode, GETDATE(), :actorCode)`,
      { replacements: { employeeCode, enabled: enabled ? '1' : '0', actorCode }, type: QueryTypes.INSERT, transaction },
    );
    for (const roleId of uniqueRoleIds) {
      await database.query(
        `INSERT INTO USER_ROLES (ID, NAME, DESCRIPTION, USER_ID, ROLE_ID, ENABLED) VALUES (NEWID(), '-', '-', :employeeCode, :roleId, '1')`,
        { replacements: { employeeCode, roleId }, type: QueryTypes.INSERT, transaction },
      );
    }
    await UserPermission.bulkCreate(
      [...activePermissionIds].map((permissionId) => ({
        USER_ID: employeeCode,
        PERMISSION_ID: permissionId,
        ENABLED: selectedPermissionIds.has(permissionId) ? '1' : '0',
      })),
      { transaction },
    );
  });
  return getUserDetail(employeeCode);
}

async function updateUserAccess(employeeCode, roleIds, permissionIds, enabled, actorCode) {
  const { User, UserPermission } = getModels();
  if (!(await User.findByPk(employeeCode))) throw serviceError(`User ${employeeCode} was not found.`, 404, 'RESOURCE_NOT_FOUND');
  await assertUserRoleLevelAllowed(actorCode, employeeCode);
  await assertRoleAssignmentAllowed(actorCode, roleIds);
  const { uniqueRoleIds, selectedPermissionIds, activePermissionIds } = await resolveAccessSelection(roleIds, permissionIds);

  const database = getDatabase();
  await database.transaction(async (transaction) => {
    await User.update(
      { ENABLED: enabled ? '1' : '0', UPDATED_DATE: fn('GETDATE'), UPDATED_BY: actorCode },
      { where: { ID: employeeCode }, transaction },
    );

    const existingRoles = await database.query(
      'SELECT ROLE_ID FROM USER_ROLES WHERE USER_ID = :employeeCode',
      { replacements: { employeeCode }, type: QueryTypes.SELECT, transaction },
    );
    const existingRoleIds = new Set(existingRoles.map((row) => String(row.ROLE_ID)));
    await database.query(
      'UPDATE USER_ROLES SET ENABLED = 0 WHERE USER_ID = :employeeCode',
      { replacements: { employeeCode }, type: QueryTypes.UPDATE, transaction },
    );
    for (const roleId of uniqueRoleIds) {
      if (existingRoleIds.has(roleId)) {
        await database.query(
          'UPDATE USER_ROLES SET ENABLED = 1 WHERE USER_ID = :employeeCode AND ROLE_ID = :roleId',
          { replacements: { employeeCode, roleId }, type: QueryTypes.UPDATE, transaction },
        );
      } else {
        await database.query(
          `INSERT INTO USER_ROLES (ID, NAME, DESCRIPTION, USER_ID, ROLE_ID, ENABLED) VALUES (NEWID(), '-', '-', :employeeCode, :roleId, '1')`,
          { replacements: { employeeCode, roleId }, type: QueryTypes.INSERT, transaction },
        );
      }
    }

    const existingPermissions = await UserPermission.findAll({ where: { USER_ID: employeeCode }, transaction });
    const existingPermissionIds = new Set(existingPermissions.map((permission) => String(permission.PERMISSION_ID)));
    for (const permissionId of activePermissionIds) {
      const values = { ENABLED: selectedPermissionIds.has(permissionId) ? '1' : '0' };
      if (existingPermissionIds.has(permissionId)) {
        await UserPermission.update(values, { where: { USER_ID: employeeCode, PERMISSION_ID: permissionId }, transaction });
      } else {
        await UserPermission.create({ USER_ID: employeeCode, PERMISSION_ID: permissionId, ...values }, { transaction });
      }
    }
  });
  return getUserDetail(employeeCode);
}
module.exports = { listUsers, getUserDetail, setSystemActive, setViewAs, clearViewAs, listAvailableEmployees, listRoleOptions, listPermissionOptions, createUser, updateUserAccess, assertUserRoleLevelAllowed };
