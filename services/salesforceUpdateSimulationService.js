const { randomUUID } = require('crypto');

const SIMULATION_DELAY_MS = 350;

function waitForSimulation() {
  return new Promise((resolve) => setTimeout(resolve, SIMULATION_DELAY_MS));
}

async function authenticate() {
  await waitForSimulation();
  return {
    accessToken: `mock-${randomUUID()}`,
    tokenType: 'Bearer',
    expiresIn: 3600,
  };
}

async function updateRequest(payload, token) {
  await waitForSimulation();
  return {
    accepted: true,
    requestId: payload.request?.id || payload.requestId || null,
    authenticatedWith: token.tokenType,
    simulatedAt: new Date().toISOString(),
  };
}

async function simulateRequestUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('A request payload is required for the Salesforce simulation.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const token = await authenticate();
  const update = await updateRequest(payload, token);
  return {
    authentication: { succeeded: true, tokenType: token.tokenType, expiresIn: token.expiresIn },
    update,
  };
}

module.exports = { simulateRequestUpdate, authenticate, updateRequest };
