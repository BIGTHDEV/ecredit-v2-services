/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../services/attachmentService', () => ({}));

const { getModels } = require('../models');
const requestService = require('../services/requestService');

describe('requestService scoring classification', () => {
  const draftStatusId = 'db8b3768-8466-4974-8dff-4c374b16a639';

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

  test('allows a Draft save without special-condition notes', async () => {
    const request = { STATUS_ID: draftStatusId, update: jest.fn().mockResolvedValue(undefined) };
    const models = {
      Request: {
        findOne: jest.fn().mockResolvedValueOnce(request).mockResolvedValueOnce(null),
        sequelize: { fn: jest.fn((name) => ({ fn: name })) },
      },
      Rating: { findOne: jest.fn().mockResolvedValue({ ID: '6692417b-a711-49c9-9015-fb232ca7d737' }) },
      Term: {},
      Status: {},
      Employee: {},
    };
    getModels.mockReturnValue(models);

    await requestService.updateRequestScoringAndPayment('request-1', {
      SCORING_PROFITABILITY: '-',
      SCORING_GROWTH: '-',
      SCORING_LIQUIDITY: '-',
      SCORING_LEVERAGE: '-',
      SCORING_RATING_ID: '',
      IS_SCORING_OTHER: true,
      SCORING_NOTES: '',
    }, 123);

    expect(request.update).toHaveBeenCalledWith(expect.objectContaining({
      SCORING_NOTES: '',
      SCORING_RATING_ID: '6692417b-a711-49c9-9015-fb232ca7d737',
    }));
    expect(models.Rating.findOne).toHaveBeenCalledWith({
      where: { ID: '6692417b-a711-49c9-9015-fb232ca7d737', ENABLED: '1' },
    });
  });

  test('preserves an unselected score when saving an incomplete Draft', async () => {
    const request = { STATUS_ID: draftStatusId, update: jest.fn().mockResolvedValue(undefined) };
    const models = {
      Request: {
        findOne: jest.fn().mockResolvedValueOnce(request).mockResolvedValueOnce(null),
        sequelize: { fn: jest.fn((name) => ({ fn: name })) },
      },
      Rating: { findOne: jest.fn() },
      Term: {},
      Status: {},
      Employee: {},
    };
    getModels.mockReturnValue(models);

    await requestService.updateRequestScoringAndPayment('request-1', {
      SCORING_PROFITABILITY: '-',
      SCORING_GROWTH: '-',
      SCORING_LIQUIDITY: '-',
      SCORING_LEVERAGE: '-',
      SCORING_RATING_ID: '',
    }, 123);

    expect(request.update).toHaveBeenCalledWith(expect.objectContaining({
      SCORING_RATING_ID: '',
    }));
    expect(models.Rating.findOne).not.toHaveBeenCalled();
  });

  test('still requires special-condition notes when saving a non-Draft request', async () => {
    const request = { STATUS_ID: 'waiting-status', update: jest.fn() };
    const models = {
      Request: { findOne: jest.fn().mockResolvedValue(request) },
      Rating: { findOne: jest.fn() },
      Term: {},
      Status: {},
      Employee: {},
    };
    getModels.mockReturnValue(models);

    await expect(requestService.updateRequestScoringAndPayment('request-1', {
      IS_SCORING_OTHER: true,
      SCORING_NOTES: '',
    }, 123)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'SCORING_NOTES is required when Others or N/A is selected.',
    });
    expect(request.update).not.toHaveBeenCalled();
  });

  test('requires a score selection when submitting, even when saving a Draft was allowed', async () => {
    await expect(requestService.submitRequest('request-1', {
      customerInfo: {
        CUSTOMER_TAX_NO: '-',
        CUSTOMER_REGISTERED_CAPITAL_AMOUNT: '0',
      },
      creditSuggestion: {
        PROPOSED_LIMIT_AMOUNT: 100000,
      },
      scoringAndPayment: {
        SCORING_PROFITABILITY: '-',
        SCORING_GROWTH: '-',
        SCORING_LIQUIDITY: '-',
        SCORING_LEVERAGE: '-',
        SCORING_RATING_ID: '',
      },
      requestedDetails: {
        IS_TERM_REQUESTED: true,
        IS_LIMIT_REQUESTED: true,
      },
      bdsReviewApproverId: '123',
      steps: [],
    }, 123)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'SCORING_RATING_ID is required when submitting a request.',
    });
  });

  test('requires special-condition notes when submitting a Draft', async () => {
    await expect(requestService.submitRequest('request-1', {
      customerInfo: {
        CUSTOMER_TAX_NO: '-',
        CUSTOMER_REGISTERED_CAPITAL_AMOUNT: '0',
      },
      creditSuggestion: {
        PROPOSED_LIMIT_AMOUNT: 100000,
      },
      scoringAndPayment: {
        SCORING_PROFITABILITY: '-',
        SCORING_GROWTH: '-',
        SCORING_LIQUIDITY: '-',
        SCORING_LEVERAGE: '-',
        SCORING_RATING_ID: '6692417b-a711-49c9-9015-fb232ca7d737',
        IS_SCORING_OTHER: true,
        SCORING_NOTES: '',
      },
      requestedDetails: {
        IS_TERM_REQUESTED: true,
        IS_LIMIT_REQUESTED: true,
      },
      bdsReviewApproverId: '123',
      steps: [],
    }, 123)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'SCORING_NOTES is required when Others or N/A is selected.',
    });
  });
});
