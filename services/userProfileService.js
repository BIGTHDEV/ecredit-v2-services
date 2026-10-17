const { getModels } = require('../models');

async function getEnabledRoleNames(userId) {
  const { UserRole, Role } = getModels();
  const userRoles = await UserRole.findAll({
    where: { USER_ID: userId, ENABLED: '1' },
    include: [{ model: Role, as: 'role', where: { ENABLED: '1' } }],
    order: [[{ model: Role, as: 'role' }, 'LEVEL', 'DESC']],
  });
  return userRoles.map((userRole) => userRole.role.NAME);
}

/**
 * Look up the full permission/profile record for a user by their M365 email.
 * Mirrors the legacy raw SQL query (USERS + USER_ROLES/ROLES + S_EMPLOYEE1 + S_MAPPING_COST_CENTER).
 *
 * @param {string} email - Email returned from the Microsoft Entra ID (M365) login
 * @returns {Promise<object|null>} Flat profile object, or null if the user has no access
 */
async function getUserProfileByEmail(email) {
  const { User, Employee, UserRole, Role, CostCenterMapping } = getModels();

  // TB1 + TB3 (+ TB5/TB6 managers) + TB4: required Employee join replicates the WHERE filter
  const user = await User.findOne({
    where: { ENABLED: '1' },
    include: [
      {
        model: Employee,
        as: 'employee',
        required: true,
        where: { CURRENT_EMAIL: email },
        include: [
          { model: Employee, as: 'manager1' },
          { model: Employee, as: 'manager2' },
        ],
      },
      {
        model: CostCenterMapping,
        as: 'costCenter',
        required: false,
      },
      {
        model: Employee,
        as: 'viewAsEmployee',
        required: false,
      },
    ],
  });

  if (!user) {
    return null;
  }

  // TB2: correlated "TOP (1) ... ORDER BY LEVEL DESC" subquery for the highest-level enabled role
  const topUserRole = await UserRole.findOne({
    where: { USER_ID: user.ID, ENABLED: '1' },
    include: [{ model: Role, as: 'role', where: { ENABLED: '1' } }],
    order: [[{ model: Role, as: 'role' }, 'LEVEL', 'DESC']],
  });

  const employee = user.employee;
  const manager1 = employee.manager1;
  const manager2 = employee.manager2;
  const costCenter = user.costCenter;
  const viewAsCode = user.VIEW_AS === null || user.VIEW_AS === undefined
    ? ''
    : String(user.VIEW_AS).trim();
  const isViewingAs = Boolean(viewAsCode && viewAsCode !== String(user.ID).trim());
  const viewAsEmployee = isViewingAs ? user.viewAsEmployee : null;
  if (isViewingAs && !viewAsEmployee) {
    const error = new Error(`View As employee ${viewAsCode} was not found.`);
    error.statusCode = 403;
    error.code = 'INVALID_VIEW_AS_TARGET';
    throw error;
  }
  const role = topUserRole ? topUserRole.role : null;

  let effectiveEmployee = employee;
  let effectiveRole = role;
  let effectiveCostCenter = costCenter;
  let effectiveManager1 = manager1;
  let effectiveManager2 = manager2;
  let effectiveRoles = await getEnabledRoleNames(employee.EMP_CODE);
  if (viewAsEmployee) {
    const viewedUserRole = await UserRole.findOne({
      where: { USER_ID: viewAsEmployee.EMP_CODE, ENABLED: '1' },
      include: [{ model: Role, as: 'role', where: { ENABLED: '1' } }],
      order: [[{ model: Role, as: 'role' }, 'LEVEL', 'DESC']],
    });
    const viewedEmployee = await Employee.findOne({
      where: { EMP_CODE: viewAsEmployee.EMP_CODE },
      include: [
        { model: Employee, as: 'manager1' },
        { model: Employee, as: 'manager2' },
      ],
    });
    const viewedCostCenter = await CostCenterMapping.findOne({
      where: { EMPLOYEE_CODE: viewAsEmployee.EMP_CODE },
    });
    effectiveEmployee = viewAsEmployee;
    effectiveRole = viewedUserRole ? viewedUserRole.role : null;
    effectiveCostCenter = viewedCostCenter;
    effectiveManager1 = viewedEmployee ? viewedEmployee.manager1 : null;
    effectiveManager2 = viewedEmployee ? viewedEmployee.manager2 : null;
    effectiveRoles = await getEnabledRoleNames(viewAsEmployee.EMP_CODE);
  }

  return {
    CODE: effectiveEmployee.EMP_CODE,
    ROLE_ID: effectiveRole ? effectiveRole.ID : null,
    ROLE: effectiveRole ? effectiveRole.NAME : null,
    ROLES: effectiveRoles,
    BU_ID: effectiveCostCenter ? effectiveCostCenter.BU_ID : null,
    BU: effectiveCostCenter ? effectiveCostCenter.BU : null,
    DEPARTMENT_ID: effectiveCostCenter ? effectiveCostCenter.DEPARTMENT_ID : null,
    DEPARTMENT: effectiveCostCenter ? effectiveCostCenter.DEPARTMENT : null,
    USERNAME: effectiveEmployee.USERNAME || '',
    INITIALS: effectiveEmployee.INITIALS || '',
    FULL_NAME: effectiveEmployee.NAME_ENG || '',
    EMAIL: effectiveEmployee.CURRENT_EMAIL || '',
    CODE_MANAGER_1: effectiveManager1 ? effectiveManager1.EMP_CODE : null,
    USERNAME_MANAGER_1: effectiveManager1 ? effectiveManager1.USERNAME || '' : '',
    INITIALS_MANAGER_1: effectiveManager1 ? effectiveManager1.INITIALS || '' : '',
    EMAIL_MANAGER_1: effectiveManager1 ? effectiveManager1.CURRENT_EMAIL || '' : '',
    CODE_MANAGER_2: effectiveManager2 ? effectiveManager2.EMP_CODE : null,
    USERNAME_MANAGER_2: effectiveManager2 ? effectiveManager2.USERNAME || '' : '',
    INITIALS_MANAGER_2: effectiveManager2 ? effectiveManager2.INITIALS || '' : '',
    EMAIL_MANAGER_2: effectiveManager2 ? effectiveManager2.CURRENT_EMAIL || '' : '',
    MAIN_CODE: employee.EMP_CODE || '',
    MAIN_EMAIL: employee.CURRENT_EMAIL || '',
    VIEW_AS_CODE: viewAsEmployee ? viewAsEmployee.EMP_CODE || '' : '',
    VIEW_AS_EMAIL: viewAsEmployee ? viewAsEmployee.CURRENT_EMAIL || '' : '',
    LOGGED_IN_CODE: employee.EMP_CODE || '',
    LOGGED_IN_EMAIL: employee.CURRENT_EMAIL || '',
    LOGGED_IN_INITIALS: employee.INITIALS || '',
    LOGGED_IN_FULL_NAME: employee.NAME_ENG || '',
    LOGGED_IN_ROLE: role ? role.NAME : null,
    LOGGED_IN_ROLE_ID: role ? role.ID : null,
    EFFECTIVE_CODE: effectiveEmployee.EMP_CODE || '',
    EFFECTIVE_EMAIL: effectiveEmployee.CURRENT_EMAIL || '',
    EFFECTIVE_ROLE: effectiveRole ? effectiveRole.NAME : null,
    LOGGED_IN_USERNAME: employee.USERNAME || '',
    IS_VIEWING_AS: isViewingAs,
  };
}

module.exports = {
  getUserProfileByEmail,
};
