/* eslint-env jest */

process.env.NODE_ENV = process.env.NODE_ENV || 'dev';

const { simulateCreateRequest } = require('../services/crmSimulationService');
const { generateSimulationIdentifiers } = require('../services/crmSimulationService');

const settings = { url: 'https://crm.example/create-request', headerKey: 'x-secret-key', headerValue: 'secret-value' };

function fakeFetch(status, body) {
  return jest.fn().mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(body) });
}

describe('simulateCreateRequest', () => {
  it('posts allowed fields with the configured header', async () => {
    const fetchImpl = fakeFetch(200, { success: true });
    const result = await simulateCreateRequest({ CRM_NO: 'CN-1', IS_LIMIT_REQUESTED: 1, UNKNOWN: 'x' }, { environment: 'qas', settings, fetchImpl });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(settings.url);
    expect(options.headers['x-secret-key']).toBe('secret-value');
    expect(JSON.parse(options.body)).toEqual({ CRM_NO: 'CN-1', IS_LIMIT_REQUESTED: 1 });
    expect(result).toEqual({ status: 200, ok: true, response: { success: true } });
  });

  describe('generateSimulationIdentifiers', () => {
    it('generates an unused CRM ID and increments the highest existing CRM number', async () => {
      const Request = {
        findAll: jest.fn().mockResolvedValue([
          { CRM_ID: 'already-used-id', CRM_NO: 'CN-20260805037' },
          { CRM_ID: 'other-id', CRM_NO: 'CN-20260805042' },
        ]),
      };
      const createId = jest.fn()
        .mockReturnValueOnce('ALREADY-USED-ID')
        .mockReturnValueOnce('new-unique-id');

      const identifiers = await generateSimulationIdentifiers({ Request, createId });

      expect(Request.findAll).toHaveBeenCalledWith({
        attributes: ['CRM_ID', 'CRM_NO'],
        raw: true,
      });
      expect(identifiers).toEqual({
        CRM_ID: 'new-unique-id',
        CRM_NO: 'CN-20260805043',
      });
    });

    it('fails explicitly if a unique CRM ID cannot be generated', async () => {
      const Request = {
        findAll: jest.fn().mockResolvedValue([{ CRM_ID: 'duplicate-id', CRM_NO: 'CN-1' }]),
      };

      await expect(generateSimulationIdentifiers({
        Request,
        createId: () => 'DUPLICATE-ID',
      })).rejects.toMatchObject({
        statusCode: 503,
        code: 'CRM_SIMULATION_ID_GENERATION_FAILED',
      });
    });

    it('creates a dated CRM number when no existing number is available', async () => {
      const Request = { findAll: jest.fn().mockResolvedValue([]) };

      const identifiers = await generateSimulationIdentifiers({
        Request,
        createId: () => 'new-id',
      });

      expect(identifiers.CRM_ID).toBe('new-id');
      expect(identifiers.CRM_NO).toMatch(/^CN-\d{8}001$/);
    });
  });

  it('is not available on PRD', async () => {
    const fetchImpl = fakeFetch(200, {});
    await expect(simulateCreateRequest({}, { environment: 'prd', settings, fetchImpl })).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the upstream error response instead of throwing', async () => {
    await expect(simulateCreateRequest({}, { environment: 'dev', settings, fetchImpl: fakeFetch(500, { message: 'boom' }) }))
      .resolves.toMatchObject({ status: 500, ok: false, response: { message: 'boom' } });
  });
});
