const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'Approver',
    {
      ID: { type: DataTypes.STRING(128), primaryKey: true, allowNull: false },
      NAME: { type: DataTypes.STRING(50), allowNull: false },
      DESCRIPTION: { type: DataTypes.TEXT, allowNull: false },
      APPROVER_ID: { type: DataTypes.INTEGER, allowNull: false },
      APPROVER_TYPE_ID: { type: DataTypes.STRING(128), allowNull: false },
      PRIMARY: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ENABLED: { type: DataTypes.BOOLEAN, allowNull: false },
      SORTING: { type: DataTypes.INTEGER, allowNull: true },
      CREATED_DATE: { type: DataTypes.DATE, allowNull: true },
      UPDATED_DATE: { type: DataTypes.DATE, allowNull: true },
      CREATED_BY: { type: DataTypes.INTEGER, allowNull: true },
      UPDATED_BY: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: 'APPROVERS',
      timestamps: false,
    },
  );
