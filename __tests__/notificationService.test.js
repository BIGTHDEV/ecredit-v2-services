/* eslint-env jest */

jest.mock('uuid', () => ({ v4: jest.fn(() => 'uuid') }));

const mockNotification = {
  sequelize: { literal: jest.fn((value) => ({ literal: value })) },
  bulkCreate: jest.fn(async (rows) => rows),
  count: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
};

jest.mock('../models', () => ({ getModels: () => ({ Notification: mockNotification }) }));

const notificationService = require('../services/notificationService');

describe('notificationService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('merges TO and CC recipients, prefers TO, and excludes the actor', () => {
    expect(notificationService.collectRecipients(
      [{ email: 'First@Example.com', name: 'FIRST' }, { email: 'actor@example.com', name: 'ACTOR' }],
      [{ email: 'first@example.com', name: 'FIRST' }, { email: 'cc@example.com', name: 'CC' }, { email: '' }],
      'ACTOR@example.com',
    )).toEqual([
      { email: 'first@example.com', name: 'FIRST', type: 'TO' },
      { email: 'cc@example.com', name: 'CC', type: 'CC' },
    ]);
  });

  it('creates one unread notification per recipient', async () => {
    const rows = await notificationService.createWorkflowNotifications({
      event: 'submit',
      requestId: 'request-1',
      toRecords: [{ email: 'first@example.com', name: 'FIRST' }],
      ccRecords: [{ email: 'cc@example.com', name: 'CC' }],
      actorEmail: 'actor@example.com',
      actorName: 'ACTOR',
      actorCode: '1009',
      emailModel: { requestNo: 'CR-001', companyName: 'Acme', salesGroup: '100 - TGEE' },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      RECIPIENT_EMAIL: 'first@example.com',
      RECIPIENT_TYPE: 'TO',
      REQUEST_ID: 'request-1',
      REQUEST_NO: 'CR-001',
      EVENT_TYPE: 'submit',
      TITLE: 'New request for your approval',
      TAB: 'approver',
      MESSAGE: 'CR-001 Acme (100 - TGEE) by ACTOR',
      IS_READ: false,
      CREATED_DATE: { literal: 'GETDATE()' },
      UPDATED_DATE: { literal: 'GETDATE()' },
      CREATED_BY: 1009,
      UPDATED_BY: 1009,
      SORTING: null,
    });
    expect(rows[1].RECIPIENT_TYPE).toBe('CC');
  });

  it('routes approval recipients to approver, completed recipients to customers, and backward recipients to the request form', async () => {
    const common = {
      requestId: 'request-1',
      actorEmail: 'actor@example.com',
      actorName: 'ACTOR',
      actorCode: '1009',
    };

    await notificationService.createWorkflowNotifications({
      ...common,
      event: 'approve',
      toRecords: [{ email: 'approver@example.com' }],
      ccRecords: [],
    });
    await notificationService.createWorkflowNotifications({
      ...common,
      event: 'completed',
      toRecords: [{ email: 'requester@example.com' }],
      ccRecords: [{ email: 'approver@example.com' }],
    });
    await notificationService.createWorkflowNotifications({
      ...common,
      event: 'backward',
      toRecords: [{ email: 'bds@example.com' }],
      ccRecords: [{ email: 'actor@example.com' }],
    });

    expect(mockNotification.bulkCreate.mock.calls[0][0].map((row) => row.TAB)).toEqual(['approver']);
    expect(mockNotification.bulkCreate.mock.calls[1][0].map((row) => row.TAB)).toEqual(['customers', 'customers']);
    expect(mockNotification.bulkCreate.mock.calls[2][0].map((row) => row.TAB)).toEqual([
      'credit-request-form',
      'credit-request-form',
    ]);
    expect(mockNotification.bulkCreate.mock.calls[2][0].map((row) => row.RECIPIENT_TYPE)).toEqual(['TO', 'CC']);
    expect(mockNotification.bulkCreate.mock.calls[2][0][1].RECIPIENT_EMAIL).toBe('actor@example.com');
  });

  it('requires the actor user code', async () => {
    await expect(notificationService.createWorkflowNotifications({
      event: 'submit',
      toRecords: [{ email: 'first@example.com' }],
      actorEmail: 'actor@example.com',
    })).rejects.toThrow('Actor user code is required');
    expect(mockNotification.bulkCreate).not.toHaveBeenCalled();
  });

  it('skips creation when only the actor would be notified', async () => {
    await expect(notificationService.createWorkflowNotifications({
      event: 'reject',
      toRecords: [{ email: 'actor@example.com' }],
      ccRecords: [],
      actorEmail: 'actor@example.com',
    })).resolves.toEqual([]);
    expect(mockNotification.bulkCreate).not.toHaveBeenCalled();
  });

  it('lists the latest notifications for the current user with unread count and hasMore', async () => {
    mockNotification.findAll.mockResolvedValue([
      { ID: 'n1', TITLE: 'A', TAB: 'approver', IS_READ: false, CREATED_DATE: new Date('2026-10-14T10:00:00Z') },
      { ID: 'n2', TITLE: 'B', TAB: 'credit-request-form', IS_READ: true, CREATED_DATE: new Date('2026-10-14T09:00:00Z') },
      { ID: 'n3', TITLE: 'C', TAB: 'customers', IS_READ: true, CREATED_DATE: new Date('2026-10-14T08:00:00Z') },
    ]);
    mockNotification.count.mockResolvedValue(1);

    const result = await notificationService.listForUser('User@Example.com', { limit: '2', offset: '0' });

    expect(mockNotification.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { RECIPIENT_EMAIL: 'user@example.com', ENABLED: true },
      limit: 3,
      offset: 0,
    }));
    expect(result.items.map((item) => item.id)).toEqual(['n1', 'n2']);
    expect(result.items[0]).toMatchObject({ isRead: false, tab: 'approver', createdDate: '2026-10-14T10:00:00.000+07:00' });
    expect(result.items[1].tab).toBe('credit-request-form');
    expect(result.unreadCount).toBe(1);
    expect(result.hasMore).toBe(true);
  });

  it('marks only the current user notification as read', async () => {
    const update = jest.fn();
    mockNotification.findOne.mockResolvedValue({ ID: 'n1', IS_READ: false, update });
    mockNotification.count.mockResolvedValue(4);

    await expect(notificationService.markRead('n1', 'user@example.com')).resolves.toEqual({ id: 'n1', unreadCount: 4 });
    expect(mockNotification.findOne).toHaveBeenCalledWith({ where: { ID: 'n1', RECIPIENT_EMAIL: 'user@example.com', ENABLED: true } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      IS_READ: true,
      READ_DATE: { literal: 'GETDATE()' },
      UPDATED_DATE: { literal: 'GETDATE()' },
    }));
  });

  it('returns 404 when the notification belongs to someone else', async () => {
    mockNotification.findOne.mockResolvedValue(null);
    await expect(notificationService.markRead('n1', 'user@example.com')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('marks only the current user notification as unread', async () => {
    const update = jest.fn();
    mockNotification.findOne.mockResolvedValue({ ID: 'n1', IS_READ: true, update });
    mockNotification.count.mockResolvedValue(5);

    await expect(notificationService.markUnread('n1', 'user@example.com')).resolves.toEqual({ id: 'n1', unreadCount: 5 });
    expect(mockNotification.findOne).toHaveBeenCalledWith({ where: { ID: 'n1', RECIPIENT_EMAIL: 'user@example.com', ENABLED: true } });
    expect(update).toHaveBeenCalledWith({ IS_READ: false, READ_DATE: null, UPDATED_DATE: { literal: 'GETDATE()' } });
  });

  it('does not update an already unread notification', async () => {
    const update = jest.fn();
    mockNotification.findOne.mockResolvedValue({ ID: 'n1', IS_READ: false, update });
    mockNotification.count.mockResolvedValue(5);

    await expect(notificationService.markUnread('n1', 'user@example.com')).resolves.toEqual({ id: 'n1', unreadCount: 5 });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 404 when marking someone else’s notification unread', async () => {
    mockNotification.findOne.mockResolvedValue(null);
    await expect(notificationService.markUnread('n1', 'user@example.com')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('marks all unread notifications as read', async () => {
    mockNotification.update.mockResolvedValue([3]);
    await expect(notificationService.markAllRead('user@example.com')).resolves.toEqual({ updated: 3, unreadCount: 0 });
    expect(mockNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({ IS_READ: true }),
      { where: { RECIPIENT_EMAIL: 'user@example.com', ENABLED: true, IS_READ: false } },
    );
  });

  it('rejects requests without a user email', async () => {
    await expect(notificationService.listForUser('')).rejects.toMatchObject({ statusCode: 400 });
  });
});
