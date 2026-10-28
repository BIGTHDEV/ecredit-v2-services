/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../services/attachmentService', () => ({}));

const { getModels } = require('../models');
const requestService = require('../services/requestService');

describe('requestService scoring classification', () => {
  test('assigns A when the four scoring values total more than 90', async () => {
    const request = { update: jest.fn().mockResolvedValue(undefined) };
    const models = {
      Request: {
        findOne: jest.fn().mockResolvedValueOnce(request).mockResolvedValueOnce(null),
        sequelize: { fn: jest.fn((name) => ({ fn: name })) },
      },
      Rating: { findOne: jest.fn().mockResolvedValue({ ID: '7f6c7c4f-49ff-4bd2-9288-2d632e2c13a3' }) },
      Term: {},
      Status: {},
      Employee: {},
    };
    getModels.mockReturnValue(models);

    await requestService.updateRequestScoringAndPayment('request-1', {
      SCORING_PROFITABILITY: '30',
      SCORING_GROWTH: '30',
      SCORING_LIQUIDITY: '20',
      SCORING_LEVERAGE: '11',
    }, 123);

    expect(request.update).toHaveBeenCalledWith(expect.objectContaining({
      SCORING_RATING_ID: '7f6c7c4f-49ff-4bd2-9288-2d632e2c13a3',
    }));
    expect(models.Rating.findOne).toHaveBeenCalledWith({
      where: { ID: '7f6c7c4f-49ff-4bd2-9288-2d632e2c13a3', ENABLED: '1' },
    });
  });
});