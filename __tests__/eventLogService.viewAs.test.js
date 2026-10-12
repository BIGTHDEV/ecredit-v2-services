/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/logger', () => ({ redactPayload: (payload) => payload }));

const { getModels } = require('../models');
const { persistRequestEvent } = require('../services/eventLogService');

describe('event log actor while Viewing As', () => {
  let Log;

  beforeEach(() => {
    Log = {
      sequelize: { literal: jest.fn((value) => value) },
      create: jest.fn().mockResolvedValue(undefined),
    };
    getModels.mockReturnValue({ Log });
  });

  async function recordEvent(path, isViewingAs = true, body = {}) {
    const effectiveCode = isViewingAs ? '20261631' : '20221459';
    const req = {
      method: path.endsWith('approval-action') || path.endsWith('/submit') ? 'POST' : 'PATCH',
      originalUrl: path,
      path,
      user: {
        displayName: 'Main User',
        email: 'main@example.com',
        profile: {
          CODE: effectiveCode,
          EFFECTIVE_CODE: effectiveCode,
          FULL_NAME: 'Viewed User',
          EMAIL: 'viewed@example.com',
          LOGGED_IN_CODE: '20221459',
          LOGGED_IN_EMAIL: 'main@example.com',
          LOGGED_IN_ROLE: 'System Admin',
          IS_VIEWING_AS: isViewingAs,
        },
      },
      body,
      query: {},
    };
    const res = { statusCode: 200, locals: { correlationId: 'correlation-1' } };

    await persistRequestEvent({ req, res, durationMs: 10 });
    return Log.create.mock.calls[0][0];
  }

  it('uses the effective user for normal request edits', async () => {
    const event = await recordEvent('/dev/api/requests/request-1/customer-info');

    expect(event).toEqual(expect.objectContaining({
      CREATED_BY: 20261631,
      UPDATED_BY: 20261631,
    }));
    expect(JSON.parse(event.DESCRIPTION).actor).toEqual(expect.objectContaining({
      employeeCode: 20261631,
      displayName: 'Viewed User',
      email: 'viewed@example.com',
    }));
    expect(JSON.parse(event.DESCRIPTION).viewing).toEqual({
      mainUser: 20221459,
      viewAs: 20261631,
    });
  });

  it('uses Main User as the audit actor for Approval/Final only', async () => {
    const event = await recordEvent('/dev/api/requests/request-1/approval-action');

    expect(event).toEqual(expect.objectContaining({
      CREATED_BY: 20261631,
      UPDATED_BY: 20221459,
    }));
    expect(JSON.parse(event.DESCRIPTION).actor).toEqual(expect.objectContaining({
      employeeCode: 20221459,
      displayName: 'Main User',
      email: 'main@example.com',
    }));
    expect(JSON.parse(event.DESCRIPTION).viewing).toEqual({
      mainUser: 20221459,
      viewAs: 20261631,
    });
  });

  it('omits viewing metadata when the Main User is not Viewing As', async () => {
    const event = await recordEvent('/dev/api/requests/request-1/customer-info', false);

    expect(JSON.parse(event.DESCRIPTION)).not.toHaveProperty('viewing');
  });

  it('persists approval customization reason and default/selected steps in Submit event payload', async () => {
    const approvalCustomization = {
      description: 'The default approver is unavailable.',
      defaultSteps: [{ approverId: 'default-approver' }],
      selectedSteps: [{ approverId: 'selected-approver' }],
    };
    const event = await recordEvent('/dev/api/requests/request-1/submit', true, {
      approvalCustomization,
    });

    expect(JSON.parse(event.DESCRIPTION).request.body.approvalCustomization).toEqual(approvalCustomization);
  });

  it('preserves approval customization details when a Submit event payload is truncated', async () => {
    const approvalCustomization = {
      description: 'The default approver is unavailable.',
      defaultSteps: [{ approverId: 'default-approver' }],
      selectedSteps: [{ approverId: 'selected-approver' }],
    };
    const event = await recordEvent('/dev/api/requests/request-1/submit', true, {
      approvalCustomization,
      longField: 'x'.repeat(33 * 1024),
    });
    const payload = JSON.parse(event.DESCRIPTION);

    expect(payload.payloadTruncated).toBe(true);
    expect(payload.request.bodyFields).toContain('approvalCustomization');
    expect(payload.request.approvalCustomization).toEqual(approvalCustomization);
  });
});
