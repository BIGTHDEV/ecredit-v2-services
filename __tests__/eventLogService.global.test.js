/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/logger', () => ({ redactPayload: (payload) => payload }));
jest.mock('../services/notificationService', () => ({ createSystemAdminErrorNotifications: jest.fn() }));

const { Op } = require('sequelize');
const { getModels } = require('../models');
const { createSystemAdminErrorNotifications } = require('../services/notificationService');
const { getAllEvent, listAllEvents, persistRequestEvent } = require('../services/eventLogService');

describe('global event logs', () => {
  const eventLog = {
    ID: 'log-1',
    NAME: 'PATCH request customer-info',
    DESCRIPTION: JSON.stringify({ request: { method: 'PATCH' } }),
    LOG_TYPE_ID: '23556cea-337f-475c-9b6a-830bfa08ab93',
    CATEGORY: 'api.request.customer-info',
    REQUEST_ID: 'request-1',
    CREATED_DATE: new Date('2026-10-14T04:00:00.000Z'),
    CREATED_BY: 123,
    updatedByEmployee: { INITIALS: 'AA', USERNAME: 'Example User' },
    request: { NO: 'REQ-001', CRM_NO: 'CRM-001', SOLD_TO: 'CUST-001', CUSTOMER_TAX_NO: '1234567890123' },
  };

  let Log;
  let Request;

  beforeEach(() => {
    Log = {
      sequelize: { literal: jest.fn((value) => value) },
      findAndCountAll: jest.fn().mockResolvedValue({ count: 1, rows: [eventLog] }),
      findOne: jest.fn().mockResolvedValue({
        ...eventLog,
        DESCRIPTION: JSON.stringify({ request: { method: 'PATCH', body: { value: 'test' } } }),
      }),
      create: jest.fn(),
    };
    Request = {
      findAll: jest.fn().mockResolvedValue([{
        ID: 'request-1',
        NO: 'REQ-001',
        CRM_NO: 'CRM-001',
        SOLD_TO: 'CUST-001',
        CUSTOMER_TAX_NO: '1234567890123',
      }]),
      findOne: jest.fn().mockResolvedValue({
        ID: 'request-1',
        NO: 'REQ-001',
        CRM_NO: 'CRM-001',
        SOLD_TO: 'CUST-001',
        CUSTOMER_TAX_NO: '1234567890123',
      }),
    };
    getModels.mockReturnValue({ Employee: {}, Log, Request });
  });

  it('lists all enabled events with request identifiers and pagination', async () => {
    const result = await listAllEvents({ page: '2', pageSize: '10' });

    expect(Log.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { ENABLED: true, REQUEST_ID: { [Op.not]: null } },
      limit: 10,
      offset: 10,
      order: [['CREATED_DATE', 'DESC']],
      distinct: true,
      include: expect.arrayContaining([
        expect.objectContaining({
          as: 'request',
          required: true,
          where: { ENABLED: true },
          on: expect.objectContaining({ val: expect.stringContaining('COLLATE DATABASE_DEFAULT') }),
        }),
      ]),
    }));
    expect(result).toEqual(expect.objectContaining({
      items: [expect.objectContaining({
        id: 'log-1',
        NO: 'REQ-001',
        CRM_NO: 'CRM-001',
        SOLD_TO: 'CUST-001',
        CUSTOMER_TAX_NO: '1234567890123',
        actor: 'AA-Example User',
      })],
      pagination: { page: 2, pageSize: 10, totalItems: 1, totalPages: 1 },
    }));
  });

  it('returns the selected global event with its parsed payload', async () => {
    const result = await getAllEvent('log-1');

    expect(Log.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { ID: 'log-1', ENABLED: true },
    }));
    expect(Request.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { ID: 'request-1' },
      raw: true,
    }));
    expect(result.payload).toEqual({ request: { method: 'PATCH', body: { value: 'test' } } });
    expect(result.NO).toBe('REQ-001');
  });

  it('filters and sorts by visible event-log columns', async () => {
    await listAllEvents({
      page: '1',
      pageSize: '25',
      sort: 'NO',
      dir: 'asc',
      NO: 'REQ-',
      name: 'customer-info',
      logTypeId: 'success',
      actor: 'Example',
    });

    const query = Log.findAndCountAll.mock.calls[0][0];
    expect(query.where['$request.NO$']).toEqual({ [Op.like]: '%REQ-%' });
    expect(query.where.LOG_TYPE_ID).toEqual({ [Op.in]: ['23556cea-337f-475c-9b6a-830bfa08ab93'] });
    expect(query.where[Op.and][0]).toEqual({
      [Op.or]: [{ NAME: { [Op.like]: '%customer-info%' } }, { CATEGORY: { [Op.like]: '%customer-info%' } }],
    });
    expect(query.where[Op.and][1]).toEqual(expect.objectContaining({
      attribute: expect.objectContaining({ fn: 'CONCAT' }),
      logic: { [Op.like]: '%Example%' },
    }));
    expect(query.order[0]).toEqual([
      expect.objectContaining({ model: Request, as: 'request' }),
      'NO',
      'ASC',
    ]);
    expect(query.order[1]).toEqual(
      ['CREATED_DATE', 'DESC'],
    );
  });

  it('does not allow sorting by the Event column', async () => {
    await listAllEvents({ sort: 'name', dir: 'asc' });

    expect(Log.findAndCountAll.mock.calls[0][0].order).toEqual([['CREATED_DATE', 'DESC']]);
  });

  it.each(['event-logs', 'email-logs'])('does not record reads of the global %s API as new events', async (path) => {
    await persistRequestEvent({
      req: {
        method: 'GET',
        originalUrl: `/dev/api/requests/${path}?page=1&pageSize=25`,
        user: { profile: { CODE: 123 } },
      },
      res: { statusCode: 200, locals: {} },
      durationMs: 5,
    });

    expect(Log.create).not.toHaveBeenCalled();
  });

  it('persists outbound Power Platform request payloads in the event description', async () => {
    const outboundRequests = [{
      system: 'Power Platform',
      method: 'POST',
      body: {
        Prompt: 'Company lookup prompt including the Tax ID.',
        userEmail: 'actor@example.com',
        userName: 'ACTOR',
        Application: 'eCredit',
        Module: 'Main',
        Remark: 'DEV|Company information lookup by Tax ID',
      },
    }];
    const req = {
      method: 'POST',
      originalUrl: '/dev/api/requests/request-1/customer-info-suggestions',
      user: { profile: { CODE: 123 } },
      body: { taxId: '1234567890123' },
      query: {},
    };
    const res = {
      statusCode: 200,
      locals: { correlationId: 'correlation-1', outboundRequests },
    };

    await persistRequestEvent({ req, res, durationMs: 10 });

    expect(JSON.parse(Log.create.mock.calls[0][0].DESCRIPTION).outboundRequests).toEqual(outboundRequests);
  });

  it('notifies System Admins when an error event is persisted', async () => {
    const req = {
      method: 'POST',
      originalUrl: '/dev/api/requests/request-1/approval-action',
      user: { email: 'actor@example.com', displayName: 'Actor', profile: { CODE: 123, EMAIL: 'actor@example.com', FULL_NAME: 'Actor' } },
      body: {},
      query: {},
    };
    const res = { statusCode: 500, locals: {} };

    await persistRequestEvent({ req, res, durationMs: 10 });

    expect(createSystemAdminErrorNotifications).toHaveBeenCalledWith(expect.objectContaining({
      source: 'Event log',
      requestId: 'request-1',
      actorEmail: 'actor@example.com',
      actorCode: 123,
      message: 'POST request approval-action returned HTTP 500',
    }));
  });
});
