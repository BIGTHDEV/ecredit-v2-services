const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'Term',
    {
      ID: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      NAME: DataTypes.STRING,
      EXPOSURE: DataTypes.DECIMAL,
    },
    {
      tableName: 'TERMS',
      timestamps: false,
    },
  );
