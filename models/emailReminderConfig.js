const { DataTypes } = require('sequelize');

module.exports = (sequelize) => sequelize.define('EmailReminderConfig', {
  ID: { type: DataTypes.STRING(128), primaryKey: true },
  TEMPLATE: { type: DataTypes.STRING(128), allowNull: false, unique: true },
  INTERVAL_VALUE: { type: DataTypes.INTEGER, allowNull: false },
  INTERVAL_UNIT: { type: DataTypes.STRING(16), allowNull: false },
  CREATED_DATE: { type: DataTypes.DATE, allowNull: false },
  UPDATED_DATE: { type: DataTypes.DATE, allowNull: false },
  CREATED_BY: { type: DataTypes.INTEGER, allowNull: false },
  UPDATED_BY: { type: DataTypes.INTEGER, allowNull: false },
  ENABLED: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  SORTING: DataTypes.INTEGER,
}, { tableName: 'EMAIL_REMINDER_CONFIGS', timestamps: false });
