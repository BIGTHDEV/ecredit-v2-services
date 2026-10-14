/* eslint-env jest */

jest.mock('../services/eventLogService', () => ({
  getAllEvent: jest.fn(),
  listAllEvents: jest.fn(),
}));

const eventLogService = require('../services/eventLogService');
const eventLogController = require('../controllers/eventLogController');

function createResponse() {
  const res = {
    locals: { correlationId: 'correlation-1' },
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('global event-log authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies access to users without an administration role', async () => {
    const next = jest.fn();

    await eventLogController.listAllEvents({ user: { profile: { ROLE: 'Credit Analyst' } }, query: {} }, createResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }));
    expect(eventLogService.listAllEvents).not.toHaveBeenCalled();
  });

  it('allows an administrator to load global logs without caching', async () => {
    const data = { items: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 } };
    const res = createResponse();
    const next = jest.fn();
    eventLogService.listAllEvents.mockResolvedValue(data);

    await eventLogController.listAllEvents(
      { user: { profile: { ROLE: 'System Admin' } }, query: { page: '1' } },
      res,
      next,
    );

    expect(eventLogService.listAllEvents).toHaveBeenCalledWith({ page: '1' });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data, correlationId: 'correlation-1' });
    expect(next).not.toHaveBeenCalled();
  });
});
