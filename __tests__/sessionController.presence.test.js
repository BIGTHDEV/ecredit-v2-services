/* eslint-env jest */

const { recordPresence } = require('../services/sessionPresenceService');
const sessionController = require('../controllers/sessionController');

jest.mock('../config/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../services/sessionPresenceService', () => ({
  recordPresence: jest.fn(),
}));

describe('sessionController.updatePresence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records presence for the logged-in employee, not the View As employee', async () => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };
    const request = {
      user: { profile: { LOGGED_IN_CODE: '1001', CODE: '2002' } },
      body: { tabId: 'bbcc092d-493a-49c2-87b8-dcf33e0e554f', active: true },
    };

    await sessionController.updatePresence(request, response, jest.fn());

    expect(recordPresence).toHaveBeenCalledWith({
      userCode: '1001',
      tabId: request.body.tabId,
      active: true,
    });
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.end).toHaveBeenCalled();
  });

  it('rejects malformed presence heartbeats', async () => {
    const next = jest.fn();
    await sessionController.updatePresence(
      { user: { profile: { CODE: '1001' } }, body: { tabId: 'invalid', active: true } },
      { setHeader: jest.fn(), status: jest.fn(), end: jest.fn() },
      next,
    );

    expect(recordPresence).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    }));
  });
});
