const { getModels } = require('../models');

function mapOption(record) {
  return { id: record.ID, label: record.NAME };
}

function mapRatingOption(record) {
  return { id: record.ID, label: record.NAME, color: record.COLOR_CODE || '' };
}

function mapTermOption(record) {
  const exposure = record.EXPOSURE === null || record.EXPOSURE === undefined
    ? null
    : Number(record.EXPOSURE);
  return {
    ...mapOption(record),
    exposure: Number.isFinite(exposure) ? exposure : null,
  };
}

async function listEnabledStatuses() {
  const { Status } = getModels();
  const statuses = await Status.findAll({
    where: { ENABLED: '1' },
    order: [['SORTING', 'ASC'], ['NAME', 'ASC']],
  });
  return statuses.map(mapOption);
}

async function listEnabledLogTypes() {
  const { LogType } = getModels();
  const logTypes = await LogType.findAll({
    where: { ENABLED: '1' },
    order: [['SORTING', 'ASC'], ['NAME', 'ASC']],
  });
  return logTypes.map(mapOption);
}

async function listEnabledRatings() {
  const { Rating } = getModels();
  const ratings = await Rating.findAll({
    where: { ENABLED: '1' },
    order: [['NAME', 'ASC']],
  });
  return ratings.map(mapRatingOption);
}

async function listTerms() {
  const { Term } = getModels();
  const terms = await Term.findAll({ order: [['NAME', 'ASC']] });
  return terms.map(mapTermOption);
}

module.exports = { listEnabledLogTypes, listEnabledRatings, listEnabledStatuses, listTerms };
