/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../services/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../services/requestEmailModelService', () => ({ getRequestEmailModel: jest.fn() }));
const { Op } = require('sequelize');
const { getModels } = require('../models');
const service = require('../services/emailLogService');
const controller = require('../controllers/emailController');

describe('global email logs', () => {
  let Email;
  let Request;
  beforeEach(() => {
    jest.restoreAllMocks();
    Email = { findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }) };
    Request = {};
    getModels.mockReturnValue({ Email, Request, Employee: {} });
  });

  test('returns request identity, status and safe summary fields across requests', async () => {
    Email.findAndCountAll.mockResolvedValue({ count: 2, rows: ['one', 'two'].map((id) => ({
      ID: `email-${id}`, REQUEST_ID: id, NAME: `Subject ${id}`, CATEGORY: 'request-approval',
      LOG_TYPE_ID: '23556cea-337f-475c-9b6a-830bfa08ab93',
      DESCRIPTION: service.buildDescription({ status: 'SENT', recipients: { to: ['to@example.com'], cc: [] }, model: { secret: 'hidden' } }),
      request: { NO: `REQ-${id}`, CRM_NO: 'CRM', SOLD_TO: '123', CUSTOMER_TAX_NO: '456' },
      updatedByEmployee: { INITIALS: 'AB', USERNAME: 'user' },
    })) });
    const result = await service.listAllEmailLogs();
    expect(result.items.map((item) => item.NO)).toEqual(['REQ-one', 'REQ-two']);
    expect(result.items[0]).toMatchObject({ status: 'SENT', actor: 'AB-user', recipients: { to: ['to@example.com'], cc: [] } });
    expect(result.items[0]).not.toHaveProperty('sendParameters');
    expect(result.items[0]).not.toHaveProperty('payload');
    expect(result.pagination).toEqual({ page: 1, pageSize: 25, totalItems: 2, totalPages: 1 });
    const options = Email.findAndCountAll.mock.calls[0][0];
    expect(options.include[1]).toMatchObject({ model: Request, as: 'request', required: true, where: { ENABLED: true } });
    expect(options.include[1].on.val).toContain('COLLATE DATABASE_DEFAULT');
    expect(options.where.REQUEST_ID).toEqual({ [Op.not]: null });
  });

  test('supports all column filters, safe sorting and pagination', async () => {
    await service.listAllEmailLogs({
      page: '2', pageSize: '50', NO: 'REQ', CRM_NO: 'CRM', SOLD_TO: '123', CUSTOMER_TAX_NO: '456',
      name: 'approval', logTypeId: 'failed', createdDate: '2026-10', actor: 'AB', sort: 'NO', dir: 'asc',
    });
    const options = Email.findAndCountAll.mock.calls[0][0];
    expect(options.where['$request.NO$']).toEqual({ [Op.like]: '%REQ%' });
    expect(options.where['$request.CRM_NO$']).toEqual({ [Op.like]: '%CRM%' });
    expect(options.where['$request.SOLD_TO$']).toEqual({ [Op.like]: '%123%' });
    expect(options.where['$request.CUSTOMER_TAX_NO$']).toEqual({ [Op.like]: '%456%' });
    expect(options.where.LOG_TYPE_ID[Op.in]).toEqual(['2d8e6e9d-0b7b-427f-a5ba-0e65f61d945b']);
    expect(options.where[Op.and]).toHaveLength(3);
    expect(options.order[0]).toEqual([{ model: Request, as: 'request' }, 'NO', 'ASC']);
    expect(options).toMatchObject({ limit: 50, offset: 50, distinct: true });
  });

  test.each(['pending', 'sent', 'success', 'error', 'unknown'])('accepts result filter %s', async (logTypeId) => {
    await service.listAllEmailLogs({ logTypeId });
    const ids = Email.findAndCountAll.mock.calls[0][0].where.LOG_TYPE_ID[Op.in];
    expect(ids).toHaveLength(logTypeId === 'unknown' ? 0 : 1);
  });

  test.each([{ name: 'x'.repeat(101) }, { NO: ['invalid'] }, { actor: {} }])('rejects invalid filters %j', async (query) => {
    await expect(service.listAllEmailLogs(query)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' });
    expect(Email.findAndCountAll).not.toHaveBeenCalled();
  });

  test('bounds pagination, defaults invalid sort and returns one page for empty results', async () => {
    const result = await service.listAllEmailLogs({ page: '-2', pageSize: '1000', sort: 'constructor', dir: 'asc' });
    expect(Email.findAndCountAll.mock.calls[0][0]).toMatchObject({ limit: 100, offset: 0, order: [['CREATED_DATE', 'DESC'], ['ID', 'DESC']] });
    expect(result.pagination.totalPages).toBe(1);
  });

  test('filters and sorts using the displayed automatic reminder actor', async () => {
    await service.listAllEmailLogs({ actor: 'Auto Reminder', sort: 'actor', dir: 'asc' });
    const options = Email.findAndCountAll.mock.calls[0][0];
    const expression = options.order[0][0];
    expect(expression.val).toContain("THEN 'System (Auto Reminder)'");
    expect(expression.val).toContain('[updatedByEmployee].[EMP_CODE] IS NULL');
    expect(expression.val).toContain('[Email].[UPDATED_BY] = 0');
    expect(expression.val).toContain('ISJSON');
    expect(options.where[Op.and][0].attribute).toBe(expression);
    expect(options.where[Op.and][0].logic).toEqual({ [Op.like]: '%Auto Reminder%' });
  });

  test.each([undefined, { ROLE: 'Credit Analyst' }])('denies non-admin global access', async (profile) => {
    const next = jest.fn();
    await controller.listAllEmails({ user: { profile }, query: {} }, { locals: {} }, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(Email.findAndCountAll).not.toHaveBeenCalled();
  });

  test.each(['System Admin', 'Super User'])('allows %s and prevents caching', async (ROLE) => {
    const res = { locals: { correlationId: 'test' }, setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await controller.listAllEmails({ user: { profile: { ROLE } }, query: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, correlationId: 'test' }));
  });

  test('forwards database errors', async () => {
    const error = new Error('Database unavailable');
    Email.findAndCountAll.mockRejectedValue(error);
    const next = jest.fn();
    await controller.listAllEmails({ user: { profile: { ROLE: 'System Admin' } }, query: {} }, { locals: {} }, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
