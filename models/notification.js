const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'Notification',
    {
      ID: { type: DataTypes.STRING(128), primaryKey: true },
      RECIPIENT_EMAIL: { type: DataTypes.STRING(320), allowNull: false },
      RECIPIENT_NAME: { type: DataTypes.STRING(512) },
      RECIPIENT_TYPE: { type: DataTypes.STRING(8), allowNull: false },
      REQUEST_ID: { type: DataTypes.STRING(128) },
      REQUEST_NO: { type: DataTypes.STRING(128) },
      EVENT_TYPE: { type: DataTypes.STRING(32), allowNull: false },
      TITLE: { type: DataTypes.STRING(512), allowNull: false },
      MESSAGE: { type: DataTypes.STRING(2048) },
      TAB: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'customers' },
      ACTOR_EMAIL: { type: DataTypes.STRING(320) },
      ACTOR_NAME: { type: DataTypes.STRING(512) },
      IS_READ: { type: DataTypes.BOOLEAN, allowNull: false },
      READ_DATE: { type: DataTypes.DATE },
      CREATED_DATE: { type: DataTypes.DATE, allowNull: false },
      UPDATED_DATE: { type: DataTypes.DATE, allowNull: false },
      CREATED_BY: { type: DataTypes.INTEGER, allowNull: false },
      UPDATED_BY: { type: DataTypes.INTEGER, allowNull: false },
      ENABLED: { type: DataTypes.BOOLEAN, allowNull: false },
      SORTING: { type: DataTypes.INTEGER },
    },
    { tableName: 'NOTIFICATIONS', timestamps: false },
  );
