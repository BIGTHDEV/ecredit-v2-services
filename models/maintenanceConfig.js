const { DataTypes } = require('sequelize');

module.exports = (sequelize) => sequelize.define('MaintenanceConfig', {
  ID: { type: DataTypes.STRING(32), primaryKey: true },
  ENABLED: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  MESSAGE: { type: DataTypes.STRING(4000), allowNull: false },
  STARTS_AT: { type: DataTypes.DATE, allowNull: true },
  ENDS_AT: { type: DataTypes.DATE, allowNull: true },
  CREATED_DATE: { type: DataTypes.DATE, allowNull: false },
  UPDATED_DATE: { type: DataTypes.DATE, allowNull: false },
  CREATED_BY: { type: DataTypes.INTEGER, allowNull: false },
  UPDATED_BY: { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: 'MAINTENANCE_CONFIG', timestamps: false });
