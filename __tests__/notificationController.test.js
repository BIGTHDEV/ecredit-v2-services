/* eslint-env jest */

jest.mock('../services/notificationService', () => ({
  listForUser: jest.fn().mockResolvedValue({ items: [], unreadCount: 0, hasMore: false }),
  countUnread: jest.fn().mockResolvedValue(0),
  markRead: jest.fn().mockResolvedValue({ id: 'notification-1', unreadCount: 0 }),
  markUnread: jest.fn().mockResolvedValue({ id: 'notification-1', unreadCount: 1 }),
  markAllRead: jest.fn().mockResolvedValue({ updated: 0, unreadCount: 0 }),
}));

const notificationService = require('../services/notificationService');
const controller = require('../controllers/notificationController');

function response() {
  return {
    locals: { correlationId: 'test-correlation-id' },
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('notificationController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the viewed user email for all notification operations during View As', async () => {
    const req = {
      user: {
        email: 'admin@example.com',
        profile: {
          IS_VIEWING_AS: true,
          EFFECTIVE_EMAIL: 'trp@example.com',
          EMAIL: 'trp@example.com',
        },
      },
      query: { limit: '20' },
      params: { id: 'notification-1' },
    };
    const next = jest.fn();

    await controller.list(req, response(), next);
    await controller.unreadCount(req, response(), next);
    await controller.markRead(req, response(), next);
    await controller.markUnread(req, response(), next);
    await controller.markAllRead(req, response(), next);

    expect(notificationService.listForUser).toHaveBeenCalledWith('trp@example.com', req.query);
    expect(notificationService.countUnread).toHaveBeenCalledWith('trp@example.com');
    expect(notificationService.markRead).toHaveBeenCalledWith('notification-1', 'trp@example.com');
    expect(notificationService.markUnread).toHaveBeenCalledWith('notification-1', 'trp@example.com');
    expect(notificationService.markAllRead).toHaveBeenCalledWith('trp@example.com');
    expect(next).not.toHaveBeenCalled();
  });

  it('does not fall back to the main user email if a View As profile has no effective email', async () => {
    const req = {
      user: {
        email: 'admin@example.com',
        profile: { IS_VIEWING_AS: true },
      },
      query: {},
    };

    await controller.list(req, response(), jest.fn());

    expect(notificationService.listForUser).toHaveBeenCalledWith('', req.query);
  });
});
