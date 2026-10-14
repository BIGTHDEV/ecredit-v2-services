const ADMIN_ROLE_NAMES = new Set(['System Admin', 'Super User']);
const ADMIN_ROLE_IDS = new Set([
  'd854d840-d18c-4a7d-87c1-a9186f8664e5',
  'fd08992c-08cc-4c39-8f0d-dfcc0cb90663',
]);
const SYSTEM_ADMIN_ROLE_ID = 'd854d840-d18c-4a7d-87c1-a9186f8664e5';

function isAdminRole(role, roleId) {
  return ADMIN_ROLE_NAMES.has(role) || ADMIN_ROLE_IDS.has(roleId);
}

function isSystemAdminRole(role, roleId) {
  return role === 'System Admin' || roleId === SYSTEM_ADMIN_ROLE_ID;
}

module.exports = { isAdminRole, isSystemAdminRole };
