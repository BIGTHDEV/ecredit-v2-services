const { DataTypes } = require('sequelize');

// S_EMPLOYEE1: also self-referenced (via APPROVER_ID1/2) to resolve manager records
module.exports = (sequelize) =>
  sequelize.define(
    'Employee',
    {
      EMP_CODE: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      USERNAME: DataTypes.STRING,
      INITIALS: DataTypes.STRING,
      NAME_ENG: DataTypes.STRING,
      CURRENT_EMAIL: DataTypes.STRING,
      APPROVER_ID1: DataTypes.STRING,
      APPROVER_ID2: DataTypes.STRING,
      WORK_STATUS: DataTypes.STRING,
    },
    {
      tableName: 'S_EMPLOYEE1',
      timestamps: false,
    },
  );
