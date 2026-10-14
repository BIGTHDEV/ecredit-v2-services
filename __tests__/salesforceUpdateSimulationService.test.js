/* eslint-env jest */

const { simulateRequestUpdate } = require('../services/salesforceUpdateSimulationService');

describe('salesforceUpdateSimulationService', () => {
  it('simulates authentication followed by a Salesforce request update', async () => {
    const result = await simulateRequestUpdate({ request: { id: 'request-1' } });

    expect(result.authentication).toEqual({
      succeeded: true,
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(result.update).toEqual(expect.objectContaining({
      accepted: true,
      requestId: 'request-1',
      authenticatedWith: 'Bearer',
    }));
    expect(result.update.simulatedAt).toEqual(expect.any(String));
  });

  it('rejects a missing or invalid payload', async () => {
    await expect(simulateRequestUpdate([]))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });
});
