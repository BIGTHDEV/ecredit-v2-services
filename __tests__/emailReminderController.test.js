/* eslint-env jest */
jest.mock('../services/emailReminderConfigService', () => ({ listSettings: jest.fn(), updateSettings: jest.fn() }));
jest.mock('../services/emailReminderService', () => ({ previewReminderRequests: jest.fn() }));
const service = require('../services/emailReminderConfigService');
const reminderService = require('../services/emailReminderService');
const controller = require('../controllers/emailReminderController');

describe('email reminder administration API', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { user: { profile: { ROLE: 'System Admin', CODE: '123' } }, params: { template: 'request-final' }, body: { enabled: true, intervalValue: 2, intervalUnit: 'days' } };
    res = { locals: {}, json: jest.fn(), setHeader: jest.fn() };
    next = jest.fn();
    service.listSettings.mockResolvedValue([]);
    service.updateSettings.mockResolvedValue({ template: 'request-final' });
    reminderService.previewReminderRequests.mockResolvedValue({ requests: [], skippedCount: 0 });
  });

  test.each(['System Admin', 'Super User'])('allows %s to read and update settings', async (role) => {
    req.user.profile.ROLE = role;
    await controller.list(req, res, next);
    await controller.update(req, res, next);
    expect(service.listSettings).toHaveBeenCalled();
    expect(service.updateSettings).toHaveBeenCalledWith('request-final', req.body, 123);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(next).not.toHaveBeenCalled();
  });

  test.each(['list', 'update', 'preview'])('denies ordinary users for %s', async (method) => {
    req.user.profile.ROLE = 'Requester';
    await controller[method](req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(service.listSettings).not.toHaveBeenCalled();
    expect(service.updateSettings).not.toHaveBeenCalled();
    expect(reminderService.previewReminderRequests).not.toHaveBeenCalled();
  });

  test('previews matching requests for administrators without changing settings', async () => {
    await controller.preview(req, res, next);
    expect(reminderService.previewReminderRequests).toHaveBeenCalledWith('request-final', req.body);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: { requests: [], skippedCount: 0 },
    }));
    expect(service.updateSettings).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('requires an audit employee code before saving', async () => {
    delete req.user.profile.CODE;
    await controller.update(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(service.updateSettings).not.toHaveBeenCalled();
  });

  test('propagates database failures through the standard error handler', async () => {
    const error = new Error('Database unavailable');
    service.listSettings.mockRejectedValueOnce(error);
    await controller.list(req, res, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
