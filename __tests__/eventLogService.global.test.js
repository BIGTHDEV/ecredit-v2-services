/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/logger', () => ({ redactPayload: (payload) => payload }));
jest.mock('../services/notificationService', () => ({ createSystemAdminErrorNotifications: jest.fn() }));

const { Op } = require('sequelize');
const { getModels } = require('../models');
const { createSystemAdminErrorNotifications } = require('../services/notificationService');
const {
  getAllEvent,
  listAllEvents,
  persistRequestEvent,
  recordSalesforceEndpointEvent,
} = require('../services/eventLogService');

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
      where: {
        ENABLED: true,
        [Op.or]: [
          { [Op.not]: { [Op.or]: ['GET', 'HEAD', 'OPTIONS'].map((method) => ({ NAME: { [Op.like]: `${method} %` } })) } },
          { CATEGORY: 'api.auth.me' },
        ],
      },
      limit: 10,
      offset: 10,
      order: [['CREATED_DATE', 'DESC']],
      distinct: true,
      include: expect.arrayContaining([
        expect.objectContaining({
          as: 'request',
          required: false,
          on: expect.objectContaining({ val: expect.stringContaining('COLLATE DATABASE_DEFAULT') }),
        }),
      ]),
    }));
    expect(result).toEqual(expect.objectContaining({
      items: [expect.objectContaining({
        id: 'log-1',
        ID: 'log-1',
        NAME: eventLog.NAME,
        CATEGORY: eventLog.CATEGORY,
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

  it('lists login and administration events without request identifiers', async () => {
    const events = [
      { ...eventLog, NAME: 'GET auth me', CATEGORY: 'api.auth.me', REQUEST_ID: null, request: null },
      { ...eventLog, NAME: 'PATCH users 123', CATEGORY: 'api.users.123', REQUEST_ID: null, request: null },
    ];
    Log.findAndCountAll.mockResolvedValue({ count: 2, rows: events });

    const result = await listAllEvents({});

    expect(result.items).toEqual(events.map((event) => expect.objectContaining({
      name: event.NAME,
      requestId: '',
      NO: '',
      CRM_NO: '',
      SOLD_TO: '',
      CUSTOMER_TAX_NO: '',
    })));
    expect(result.pagination.totalItems).toBe(2);
  });

  it('opens a login payload without looking up a request', async () => {
    Log.findOne.mockResolvedValue({ ...eventLog, REQUEST_ID: null });

    const result = await getAllEvent('log-1');

    expect(Request.findOne).not.toHaveBeenCalled();
    expect(result.NO).toBe('');
    expect(result.payload).toEqual({ request: { method: 'PATCH' } });
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

  it.each(['ID', 'NAME', 'CATEGORY'])('filters and sorts the raw %s column', async (field) => {
    await listAllEvents({ [field]: 'raw-value', sort: field, dir: 'asc' });

    const query = Log.findAndCountAll.mock.calls[0][0];
    expect(query.where[field]).toEqual({ [Op.like]: '%raw-value%' });
    expect(query.order).toEqual([[field, 'ASC'], ['CREATED_DATE', 'DESC']]);
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

  it.each([
    ['GET', '/dev/api/requests/request-1'],
    ['GET', '/qas/api/users'],
    ['GET', '/prd/api/approvers'],
    ['GET', '/dev/api/requests/request-1/attachments'],
    ['HEAD', '/dev/api/auth/me'],
    ['OPTIONS', '/dev/api/users'],
  ])('does not record routine %s %s events', async (method, originalUrl) => {
    await persistRequestEvent({
      req: { method, originalUrl, user: { profile: { CODE: 123 } } },
      res: { statusCode: 200, locals: {} },
      durationMs: 5,
    });

    expect(Log.create).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/dev/api/auth/me', 'api.auth.me'],
    ['GET', '/qas/api/auth/me?session=active', 'api.auth.me'],
    ['POST', '/dev/api/users', 'api.users'],
    ['PATCH', '/qas/api/users/123', 'api.users.123'],
    ['PUT', '/prd/api/approvers/123', 'api.approvers.123'],
    ['DELETE', '/dev/api/approvers/123', 'api.approvers.123'],
  ])('records %s %s without requiring an eCredit number', async (method, originalUrl, category) => {
    await persistRequestEvent({
      req: { method, originalUrl, user: { profile: { CODE: 123 } }, query: {}, body: {} },
      res: { statusCode: 200, locals: {} },
      durationMs: 5,
    });

    expect(Log.create).toHaveBeenCalledWith(expect.objectContaining({
      CATEGORY: category,
      REQUEST_ID: null,
      CREATED_BY: 123,
      UPDATED_BY: 123,
    }));
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

  it.each([
    ['POST', '/dev/api/session/presence', 204],
    ['GET', '/qas/api/session/ping?tab=1', 200],
  ])('does not persist successful %s %s heartbeats', async (method, originalUrl, statusCode) => {
    await persistRequestEvent({
      req: { method, originalUrl, user: { profile: { CODE: 123 } } },
      res: { statusCode, locals: {} },
      durationMs: 5,
    });
    expect(Log.create).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', '/dev/api/session/presence', 400],
    ['POST', '/prd/api/session/presence', 500],
    ['GET', '/qas/api/session/ping', 500],
  ])('preserves %s %s heartbeat failures with status %s', async (method, originalUrl, statusCode) => {
    await persistRequestEvent({
      req: { method, originalUrl, user: { profile: { CODE: 123 } }, query: {} },
      res: { statusCode, locals: {} },
      durationMs: 5,
    });
    expect(Log.create).toHaveBeenCalledWith(expect.objectContaining({
      LOG_TYPE_ID: statusCode >= 500 ? '2d8e6e9d-0b7b-427f-a5ba-0e65f61d945b' : '69bd78f0-a012-4d47-bfed-4c0abd316877',
    }));
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

  it.each([
    ['crm/create-request', 'POST crm request', 'integration.salesforce.request'],
    ['oauth2/token', 'POST crm auth', 'integration.salesforce.auth'],
    ['apexrest/Update_Credit_Rating_Credit_Limit/update_credit_e_credit', 'POST crm update', 'integration.salesforce.update'],
  ])('uses the short CRM event label for %s', async (endpoint, name, category) => {
    await recordSalesforceEndpointEvent({
      requestId: 'request-1',
      correlationId: 'correlation-1',
      actorCode: 123,
      endpoint,
      success: false,
      httpStatus: 200,
      durationMs: 430,
      message: 'CRM error',
    });

    expect(Log.create).toHaveBeenCalledWith(expect.objectContaining({
      NAME: name,
      CATEGORY: category,
      REQUEST_ID: 'request-1',
      LOG_TYPE_ID: '2d8e6e9d-0b7b-427f-a5ba-0e65f61d945b',
      DESCRIPTION: expect.stringContaining('CRM error'),
    }));
  });

  it.each([true, false])('persists the CRM update body with null and empty values when success is %s', async (success) => {
    const requestBody = {
      credit: {
        credit_id: 'a0IBK000006TloN2AS',
        credit_status: '100000003',
        credit_limit: null,
        terms: '',
        rating: '',
      },
    };

    await recordSalesforceEndpointEvent({
      requestId: 'request-1',
      endpoint: 'apexrest/Update_Credit_Rating_Credit_Limit/update_credit_e_credit',
      success,
      httpStatus: success ? 200 : 500,
      durationMs: 10,
      requestBody,
    });

    expect(JSON.parse(Log.create.mock.calls[0][0].DESCRIPTION).request.body).toEqual(requestBody);
  });

  it('does not persist OAuth credentials even if a request body is supplied', async () => {
    await recordSalesforceEndpointEvent({
      endpoint: 'oauth2/token',
      success: true,
      httpStatus: 200,
      requestBody: { client_secret: 'private-secret', password: 'private-password' },
    });

    const description = Log.create.mock.calls[0][0].DESCRIPTION;
    expect(JSON.parse(description)).not.toHaveProperty('request');
    expect(description).not.toContain('private-secret');
    expect(description).not.toContain('private-password');
  });

  it.each([
    ['integration.salesforce.request', 'Salesforce create request failed', 'POST crm request'],
    ['integration.salesforce.auth', 'Salesforce oauth2/token failed', 'POST crm auth'],
    ['integration.salesforce.update', 'Salesforce Apex endpoint failed', 'POST crm update'],
  ])('shows the short Salesforce name for existing %s events', async (category, storedName, displayName) => {
    Log.findOne.mockResolvedValue({ ...eventLog, NAME: storedName, CATEGORY: category });

    const result = await getAllEvent('log-1');

    expect(result.name).toBe(displayName);
    expect(result.NAME).toBe(storedName);
    expect(result.CATEGORY).toBe(category);
  });
});
