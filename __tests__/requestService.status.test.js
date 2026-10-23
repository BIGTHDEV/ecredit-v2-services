/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../services/attachmentService', () => ({}));

const { getModels } = require('../models');
const { getDatabase } = require('../config/database');
const requestService = require('../services/requestService');

const requestId = 'request-status-1';
const updatedBy = 12345;
const draftStatusId = 'db8b3768-8466-4974-8dff-4c374b16a639';
const waitingStatusId = '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b';
const finalStatusId = '014e8e8b-42cf-4b2f-8cae-e395e26efbcd';
const cancelledStatusId = '31d531f4-0420-4db5-aecf-bcfe4a0e8c4a';
const completedStatusId = '407e23f9-caf5-4c4a-801d-598cf437d1ae';
const rejectedStatusId = '94589a22-12e5-4298-aa30-06295acbe1b9';

describe('requestService.changeRequestStatus', () => {
  let database;
  let transaction;

  beforeEach(() => {
    transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    database = {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn(),
    };
    getDatabase.mockReturnValue(database);
    getModels.mockReturnValue({
      Request: { findOne: jest.fn().mockResolvedValue(null) },
      Rating: {},
      Term: {},
      Status: {},
      Employee: {},
    });
  });

  it('moves a request to Draft and disables every assigned approval row', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: waitingStatusId }])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([1]);

    await requestService.changeRequestStatus(requestId, draftStatusId, updatedBy, true);

    expect(database.query.mock.calls[1][0]).toContain('SET ENABLED = \'0\'');
    expect(database.query.mock.calls[1][1].replacements).toEqual({ id: requestId, updatedBy });
    expect(database.query.mock.calls[2][0]).toContain('SET STATUS_ID = :statusId');
    expect(database.query.mock.calls[2][1].replacements).toEqual({
      id: requestId,
      updatedBy,
      statusId: draftStatusId,
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rejects Waiting-Approval without an assigned approval row', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: draftStatusId }])
      .mockResolvedValueOnce([]);

    await expect(requestService.changeRequestStatus(requestId, waitingStatusId, updatedBy))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(database.query).toHaveBeenCalledTimes(2);
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('reopens all assigned approvals as Pending when moving to Waiting-Approval', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: draftStatusId }])
      .mockResolvedValueOnce([{ ID: 'approval-1' }])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([1]);

    await requestService.changeRequestStatus(requestId, waitingStatusId, updatedBy, true);

    expect(database.query.mock.calls[2][0]).toContain('SET ENABLED = \'1\', APPROVAL_TYPE_ID = :pendingTypeId');
    expect(database.query.mock.calls[2][1].replacements).toEqual({
      id: requestId,
      updatedBy,
      pendingTypeId: 'b4c27a6c-ab7c-4ce5-b885-997f9104c23d',
    });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('approves enabled approvals when moving to Final', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: waitingStatusId }])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([1]);

    await requestService.changeRequestStatus(requestId, finalStatusId, updatedBy, true);

    expect(database.query.mock.calls[1][0]).toContain('SET APPROVAL_TYPE_ID = :approvedTypeId');
    expect(database.query.mock.calls[1][0]).toContain("AND ENABLED = '1'");
    expect(database.query.mock.calls[1][1].replacements).toEqual({
      id: requestId,
      updatedBy,
      approvedTypeId: 'aab5ce03-1c54-48c8-8305-6b1a017b43fd',
    });
    expect(database.query.mock.calls[2][1].replacements.statusId).toBe(finalStatusId);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('marks all enabled approvals as Approved regardless of the new request status', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: waitingStatusId }])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([1]);

    await requestService.changeRequestStatus(requestId, draftStatusId, updatedBy, false, true);

    expect(database.query.mock.calls[1][0]).toContain('SET APPROVAL_TYPE_ID = :approvedTypeId');
    expect(database.query.mock.calls[1][0]).toContain("AND ENABLED = '1'");
    expect(database.query.mock.calls[1][0]).not.toContain("SET ENABLED = '0'");
    expect(database.query.mock.calls[1][1].replacements).toEqual({
      id: requestId,
      updatedBy,
      approvedTypeId: 'aab5ce03-1c54-48c8-8305-6b1a017b43fd',
    });
    expect(database.query.mock.calls[2][1].replacements.statusId).toBe(draftStatusId);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('applies the latest enabled approval values and marks enabled approvals Approved when Completed', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: finalStatusId }])
      .mockResolvedValueOnce([{
        LIMIT_AMOUNT: 250000,
        TERM_ID: 'approved-term',
        RATING_ID: 'approved-rating',
        VALID_FROM: new Date('2026-09-01T00:00:00.000Z'),
        VALID_TO: new Date('2026-09-30T00:00:00.000Z'),
        DESCRIPTION: 'Final approval',
        IS_PERMANENT: false,
        IS_TEMPORARY: true,
      }])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([1]);

    await requestService.changeRequestStatus(requestId, completedStatusId, updatedBy, true);

    expect(database.query.mock.calls[1][0]).toContain('ORDER BY UPDATED_DATE DESC, SORTING DESC');
    expect(database.query.mock.calls[2][1].replacements.approvedTypeId)
      .toBe('aab5ce03-1c54-48c8-8305-6b1a017b43fd');
    expect(database.query.mock.calls[3][1].replacements).toEqual(expect.objectContaining({
      statusId: completedStatusId,
      APPROVED_LIMIT_AMOUNT: 250000,
      APPROVED_TERM_ID: 'approved-term',
      IS_LIMIT_APPROVED: true,
      IS_TERM_APPROVED: true,
      APPROVED_RATING_ID: 'approved-rating',
      APPROVED_NOTES: 'Final approval',
      IS_PERMANENT_APPROVED: false,
      IS_TEMPORARY_APPROVED: true,
    }));
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported and unchanged statuses before updating records', async () => {
    await expect(requestService.changeRequestStatus(requestId, 'unknown-status', updatedBy))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(database.transaction).not.toHaveBeenCalled();

    database.query.mockResolvedValueOnce([{ ID: requestId, STATUS_ID: finalStatusId }]);
    await expect(requestService.changeRequestStatus(requestId, finalStatusId, updatedBy))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(database.query).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('changes only the main status when approver updates are not selected', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: waitingStatusId }])
      .mockResolvedValueOnce([1]);

    await requestService.changeRequestStatus(requestId, draftStatusId, updatedBy);

    expect(database.query).toHaveBeenCalledTimes(2);
    expect(database.query.mock.calls[1][0]).toContain('UPDATE REQUESTS');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('does not update approvals or Final Stage values when completing without approver updates', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: finalStatusId }])
      .mockResolvedValueOnce([1]);

    await requestService.changeRequestStatus(requestId, completedStatusId, updatedBy);

    expect(database.query).toHaveBeenCalledTimes(2);
    expect(database.query.mock.calls[1][0]).toContain('UPDATE REQUESTS');
    expect(database.query.mock.calls[1][0]).not.toContain('APPROVED_LIMIT_AMOUNT');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it.each([cancelledStatusId, rejectedStatusId])('allows an admin status change to CRM status %s', async (statusId) => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId, STATUS_ID: waitingStatusId }])
      .mockResolvedValueOnce([1]);

    await requestService.changeRequestStatus(requestId, statusId, updatedBy);

    expect(database.query.mock.calls[1][1].replacements.statusId).toBe(statusId);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });
});
