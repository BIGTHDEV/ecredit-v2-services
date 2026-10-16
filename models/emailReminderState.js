const { DataTypes } = require('sequelize');

module.exports = (sequelize) => sequelize.define('EmailReminderState', {
  ID: { type: DataTypes.STRING(128), primaryKey: true },
  CONFIG_ID: { type: DataTypes.STRING(128), allowNull: false },
  SOURCE_EMAIL_ID: { type: DataTypes.STRING(128), allowNull: false },
  REQUEST_ID: { type: DataTypes.STRING(128), allowNull: false },
  LAST_SENT_DATE: DataTypes.DATE,
  LAST_ATTEMPT_DATE: DataTypes.DATE,
  SENT_COUNT: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  LAST_ERROR: DataTypes.STRING(2048),
  CREATED_DATE: { type: DataTypes.DATE, allowNull: false },
  UPDATED_DATE: { type: DataTypes.DATE, allowNull: false },
  CREATED_BY: { type: DataTypes.INTEGER, allowNull: false },
  UPDATED_BY: { type: DataTypes.INTEGER, allowNull: false },
  ENABLED: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  SORTING: DataTypes.INTEGER,
}, { tableName: 'EMAIL_REMINDER_STATES', timestamps: false });
