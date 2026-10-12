const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'ApproverType',
    {
      ID: { type: DataTypes.STRING(128), primaryKey: true },
      NAME: DataTypes.STRING(50),
      ENABLED: DataTypes.BOOLEAN,
      SORTING: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      tableName: 'APPROVER_TYPES',
      timestamps: false,
    },
  );
