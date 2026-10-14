const defineUser = require('./user');
const defineEmployee = require('./employee');
const defineRole = require('./role');
const defineUserRole = require('./userRole');
const defineCostCenterMapping = require('./costCenterMapping');
const defineRequest = require('./request');
const defineRating = require('./rating');
const defineTerm = require('./term');
const defineStatus = require('./status');
const defineSize = require('./size');
const defineCustomer = require('./customer');
const definePermission = require('./permission');
const defineRolePermission = require('./rolePermission');
const defineUserPermission = require('./userPermission');
const defineAttachment = require('./attachment');
const defineLog = require('./log');
const defineCustomerLog = require('./customerLog');
const defineLogType = require('./logType');
const defineApproval = require('./approval');
const defineApprover = require('./approver');
const defineApproverType = require('./approverType');
const defineEmail = require('./email');

/**
 * Sequelize model registry
 * Models must be initialized once via initModels(sequelize) after the DB
 * connection is established (see app.js), then retrieved via getModels().
 */
let models = null;

function initModels(sequelize) {
  const User = defineUser(sequelize);
  const Employee = defineEmployee(sequelize);
  const Role = defineRole(sequelize);
  const UserRole = defineUserRole(sequelize);
  const CostCenterMapping = defineCostCenterMapping(sequelize);
  const Request = defineRequest(sequelize);
  const Rating = defineRating(sequelize);
  const Term = defineTerm(sequelize);
  const Status = defineStatus(sequelize);
  const Size = defineSize(sequelize);
  const Customer = defineCustomer(sequelize);
  const Permission = definePermission(sequelize);
  const RolePermission = defineRolePermission(sequelize);
  const UserPermission = defineUserPermission(sequelize);
  const Attachment = defineAttachment(sequelize);
  const Log = defineLog(sequelize);
  const CustomerLog = defineCustomerLog(sequelize);
  const LogType = defineLogType(sequelize);
  const Approval = defineApproval(sequelize);
  const Approver = defineApprover(sequelize);
  const ApproverType = defineApproverType(sequelize);
  const Email = defineEmail(sequelize);

  // TB1 -> TB2 (USERS.ID = S_EMPLOYEE1.EMP_CODE)
  User.hasOne(Employee, { as: 'employee', foreignKey: 'EMP_CODE', sourceKey: 'ID' });
  Employee.belongsTo(User, { as: 'user', foreignKey: 'EMP_CODE', targetKey: 'ID' });
  User.belongsTo(Employee, { as: 'updatedByEmployee', foreignKey: 'UPDATED_BY', targetKey: 'EMP_CODE' });

  // TB1 -> TB3 (USERS.VIEW_AS = S_EMPLOYEE1.EMP_CODE)
  User.belongsTo(Employee, { as: 'viewAsEmployee', foreignKey: 'VIEW_AS', targetKey: 'EMP_CODE' });

  // TB3 -> TB5 / TB3 -> TB6 (self-join via APPROVER_ID1 / APPROVER_ID2)
  Employee.belongsTo(Employee, { as: 'manager1', foreignKey: 'APPROVER_ID1', targetKey: 'EMP_CODE' });
  Employee.belongsTo(Employee, { as: 'manager2', foreignKey: 'APPROVER_ID2', targetKey: 'EMP_CODE' });

  Approver.belongsTo(Employee, { as: 'employee', foreignKey: 'APPROVER_ID', targetKey: 'EMP_CODE' });
  Approver.belongsTo(Employee, { as: 'updatedByEmployee', foreignKey: 'UPDATED_BY', targetKey: 'EMP_CODE' });
  Approver.belongsTo(ApproverType, { as: 'approverType', foreignKey: 'APPROVER_TYPE_ID', targetKey: 'ID' });

  // TB1 -> TB4 (USERS.ID = S_MAPPING_COST_CENTER.EMPLOYEE_CODE)
  User.hasOne(CostCenterMapping, { as: 'costCenter', foreignKey: 'EMPLOYEE_CODE', sourceKey: 'ID' });

  // TB1 -> TB2 (USERS.ID = USER_ROLES.USER_ID), TB2 -> ROLES
  User.hasMany(UserRole, { as: 'userRoles', foreignKey: 'USER_ID', sourceKey: 'ID' });
  UserRole.belongsTo(Role, { as: 'role', foreignKey: 'ROLE_ID' });

  Request.belongsTo(Rating, { as: 'existingRating', foreignKey: 'EXISTING_RATING_ID' });
  Request.belongsTo(Rating, { as: 'requestedRating', foreignKey: 'REQUESTED_RATING_ID' });
  Request.belongsTo(Rating, { as: 'proposedRating', foreignKey: 'PROPOSED_RATING_ID' });
  Request.belongsTo(Rating, { as: 'approvedRating', foreignKey: 'APPROVED_RATING_ID' });
  Request.belongsTo(Size, { as: 'size', foreignKey: 'CUSTOMER_SIZE_ID' });
  Request.belongsTo(Term, { as: 'existingTerm', foreignKey: 'EXISTING_TERM_ID' });
  Request.belongsTo(Term, { as: 'requestedTerm', foreignKey: 'REQUESTED_TERM_ID' });
  Request.belongsTo(Term, { as: 'proposedTerm', foreignKey: 'PROPOSED_TERM_ID' });
  Request.belongsTo(Term, { as: 'approvedTerm', foreignKey: 'APPROVED_TERM_ID' });
  Request.belongsTo(Status, { as: 'status', foreignKey: 'STATUS_ID' });
  Request.belongsTo(Employee, { as: 'requestedByEmployee', foreignKey: 'REQUESTED_BY', targetKey: 'EMP_CODE' });
  Request.belongsTo(Employee, { as: 'updatedByEmployee', foreignKey: 'UPDATED_BY', targetKey: 'EMP_CODE' });
  Request.hasMany(Attachment, { as: 'attachments', foreignKey: 'REQUEST_ID', sourceKey: 'ID' });
  Attachment.belongsTo(Request, { as: 'request', foreignKey: 'REQUEST_ID', targetKey: 'ID' });
  Attachment.belongsTo(Employee, { as: 'updatedByEmployee', foreignKey: 'UPDATED_BY', targetKey: 'EMP_CODE' });

  Customer.belongsTo(Size, { as: 'size', foreignKey: 'SIZE_ID' });
  Customer.belongsTo(Employee, { as: 'updatedByEmployee', foreignKey: 'UPDATED_BY', targetKey: 'EMP_CODE' });

  Log.belongsTo(Employee, { as: 'updatedByEmployee', foreignKey: 'UPDATED_BY', targetKey: 'EMP_CODE' });
  Log.belongsTo(Request, { as: 'request', foreignKey: 'REQUEST_ID', targetKey: 'ID' });
  CustomerLog.belongsTo(Employee, { as: 'createdByEmployee', foreignKey: 'CREATED_BY', targetKey: 'EMP_CODE' });
  CustomerLog.belongsTo(LogType, { as: 'logType', foreignKey: 'LOG_TYPE_ID', targetKey: 'ID' });
  Email.belongsTo(Employee, { as: 'updatedByEmployee', foreignKey: 'UPDATED_BY', targetKey: 'EMP_CODE' });

  // ROLE_PERMISSIONS: Role <-> Permission grants
  RolePermission.belongsTo(Role, { as: 'role', foreignKey: 'ROLE_ID' });
  RolePermission.belongsTo(Permission, { as: 'permission', foreignKey: 'PERMISSION_ID' });

  // USER_PERMISSIONS: per-user override of role-derived permission grants
  UserPermission.belongsTo(Permission, { as: 'permission', foreignKey: 'PERMISSION_ID' });
  UserPermission.belongsTo(User, { as: 'user', foreignKey: 'USER_ID', targetKey: 'ID' });

  models = {
    User,
    Employee,
    Role,
    UserRole,
    CostCenterMapping,
    Request,
    Rating,
    Term,
    Status,
    Size,
    Customer,
    Permission,
    RolePermission,
    UserPermission,
    Attachment,
    Log,
    CustomerLog,
    LogType,
    Approval,
    Approver,
    ApproverType,
    Email,
  };
  return models;
}

function getModels() {
  if (!models) {
    throw new Error('Models not initialized. Call initModels(sequelize) after initializeDatabase().');
  }
  return models;
}

function isModelsInitialized() {
  return Boolean(models);
}

function resetModels() {
  models = null;
}

module.exports = {
  initModels,
  getModels,
  isModelsInitialized,
  resetModels,
};
