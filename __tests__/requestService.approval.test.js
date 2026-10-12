/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../services/attachmentService', () => ({}));

const { getModels } = require('../models');
const { getDatabase } = require('../config/database');
const requestService = require('../services/requestService');

const requestId = 'request-1';
const approvalId = 'approval-2';
const updatedBy = 12345;
const finalStatusId = '014e8e8b-42cf-4b2f-8cae-e395e26efbcd';
const rejectedStatusId = '94589a22-12e5-4298-aa30-06295acbe1b9';
const completedStatusId = '407e23f9-caf5-4c4a-801d-598cf437d1ae';
const cancelledStatusId = '31d531f4-0420-4db5-aecf-bcfe4a0e8c4a';

function approvalPayload(action = 'save') {
  return {
    action,
    APPROVAL_ID: approvalId,
    DESCRIPTION: 'Reviewed',
    LIMIT_AMOUNT: 100000,
    TERM_ID: 'term-1',
    RATING_ID: 'rating-1',
    IS_PERMANENT: false,
    IS_TEMPORARY: true,
    VALID_FROM: '2026-09-08',
    VALID_TO: '2026-09-30',
    IS_CLEAR_OUTSTANDING_BALANCE: true,
    IS_WITHIN_APPROVED_LIMIT: false,
    IS_BANK_GUARANTEE: true,
    BANK_GUARANTEE_AMOUNT: 5000,
    IS_CASH_DEPOSIT: false,
    CASH_DEPOSIT_AMOUNT: 0,
  };
}

function submitCommand(steps) {
  return {
    customerInfo: {
      CUSTOMER_TAX_NO: '-',
      CUSTOMER_REGISTERED_CAPITAL_AMOUNT: '0',
    },
    creditSuggestion: {
      PROPOSED_LIMIT_AMOUNT: 100000,
    },
    scoringAndPayment: {
      SCORING_PROFITABILITY: '-',
    },
    requestedDetails: {
      IS_TERM_REQUESTED: true,
      IS_LIMIT_REQUESTED: true,
    },
    bdsReviewApproverId: String(updatedBy),
    steps,
  };
}

describe('requestService.processApprovalAction', () => {
  let approvalUpdate;
  let requestUpdate;
  let database;
  let transaction;
  let sequelize;

  beforeEach(() => {
    transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    database = {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn(),
    };
    sequelize = {
      fn: jest.fn((name) => ({ fn: name })),
    };
    approvalUpdate = jest.fn().mockResolvedValue([1]);
    requestUpdate = jest.fn().mockResolvedValue([1]);

    getDatabase.mockReturnValue(database);
    getModels.mockReturnValue({
      Approval: { update: approvalUpdate, sequelize },
      Request: { findOne: jest.fn().mockResolvedValue(null), update: requestUpdate, sequelize },
      Rating: {},
      Term: {},
      Status: {},
      Employee: {},
    });
  });

  it('saves mapped fields by approval and request ID without changing status', async () => {
    database.query.mockResolvedValueOnce([{ ID: approvalId }]);

    await requestService.processApprovalAction(
      requestId,
      'save',
      approvalPayload(),
      updatedBy,
    );

    expect(database.query).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[0][1].replacements).toEqual({
      id: requestId,
      approvalId,
      updatedBy,
      isSystemAdmin: 0,
      waitingStatusId: '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b',
      pendingApprovalTypeId: 'b4c27a6c-ab7c-4ce5-b885-997f9104c23d',
      allowFinalSave: 1,
      finalStatusId: '014e8e8b-42cf-4b2f-8cae-e395e26efbcd',
    });
    expect(approvalUpdate).toHaveBeenCalledWith(
      expect.not.objectContaining({ APPROVAL_TYPE_ID: expect.anything() }),
      expect.objectContaining({
        where: { ID: approvalId, REQUEST_ID: requestId, ENABLED: true },
        transaction,
      }),
    );
    expect(approvalUpdate.mock.calls[0][0]).toEqual(expect.objectContaining({
      DESCRIPTION: 'Reviewed',
      LIMIT_AMOUNT: 100000,
      TERM_ID: 'term-1',
      RATING_ID: 'rating-1',
      IS_PERMANENT: false,
      IS_TEMPORARY: true,
      IS_CLEAR_OUTSTANDING_BALANCE: true,
      IS_WITHIN_APPROVED_LIMIT: false,
      IS_BANK_GUARANTEE: true,
      BANK_GUARANTEE_AMOUNT: 5000,
      IS_CASH_DEPOSIT: false,
      CASH_DEPOSIT_AMOUNT: 0,
      UPDATED_BY: updatedBy,
      UPDATED_DATE: { fn: 'GETDATE' },
    }));
    expect(requestUpdate).toHaveBeenCalledWith(
      { UPDATED_BY: updatedBy, UPDATED_DATE: { fn: 'GETDATE' } },
      { where: { ID: requestId, ENABLED: true }, transaction },
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('checks approval as the effective user while stamping the separate audit user', async () => {
    const auditBy = 20221459;
    database.query.mockResolvedValueOnce([{ ID: approvalId }]);

    await requestService.processApprovalAction(
      requestId,
      'save',
      approvalPayload(),
      updatedBy,
      false,
      auditBy,
    );

    expect(database.query.mock.calls[0][1].replacements.updatedBy).toBe(updatedBy);
    expect(approvalUpdate.mock.calls[0][0].UPDATED_BY).toBe(auditBy);
    expect(requestUpdate).toHaveBeenCalledWith(
      { UPDATED_BY: auditBy, UPDATED_DATE: { fn: 'GETDATE' } },
      { where: { ID: requestId, ENABLED: true }, transaction },
    );
  });

  it('changes approval status when approving the selected approval ID', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: approvalId, APPROVER_ID: 67890, APPROVAL_STEP: 4 }])
      .mockResolvedValueOnce([{ ID: 'approved-type' }])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([{ TOTAL: 0 }]);

    await requestService.processApprovalAction(
      requestId,
      'approve',
      approvalPayload('approve'),
      updatedBy,
    );

    expect(approvalUpdate.mock.calls[0][0].APPROVAL_TYPE_ID).toBe('approved-type');
    expect(database.query.mock.calls[1][1].replacements).toEqual({ approvalTypeName: 'Approved' });
    expect(database.query.mock.calls[0][0]).toContain('TB1.APPROVAL_STEP');
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        STATUS_ID: finalStatusId,
        APPROVED_LIMIT_AMOUNT: 100000,
        APPROVED_TERM_ID: 'term-1',
        IS_LIMIT_APPROVED: true,
        IS_TERM_APPROVED: true,
        APPROVED_RATING_ID: 'rating-1',
        APPROVED_VALID_FROM: { fn: 'DATEFROMPARTS' },
        APPROVED_VALID_TO: { fn: 'DATEFROMPARTS' },
        APPROVED_NOTES: 'Reviewed',
        IS_PERMANENT_APPROVED: false,
        IS_TEMPORARY_APPROVED: true,
      }),
      expect.objectContaining({ where: { ID: requestId, ENABLED: true }, transaction }),
    );
    expect(database.query.mock.calls[2][0]).toContain('TRY_CONVERT(BIGINT, APPROVER_ID)');
    expect(database.query.mock.calls[2][0]).not.toContain('MIN(APPROVAL_STEP)');
    expect(database.query.mock.calls[2][1].replacements.id).toBe(requestId);
    expect(database.query.mock.calls[2][1].replacements.updatedBy).toBe(updatedBy);
    expect(database.query.mock.calls[2][1].replacements.approverId).toBe(67890);
    expect(database.query.mock.calls[2][1].replacements.approvedTypeId).toBe('approved-type');
    expect(database.query.mock.calls[2][1].replacements.pendingApprovalTypeId)
      .toBe('b4c27a6c-ab7c-4ce5-b885-997f9104c23d');
    expect(database.query.mock.calls[3][0]).toContain('NOT EXISTS');
    expect(database.query.mock.calls[3][0]).toContain('TB1.APPROVAL_STEP > :approvalStep');
    expect(database.query.mock.calls[3][1].replacements).toEqual(expect.objectContaining({
      requestId,
      approvalId,
      approvalStep: 4,
      auditBy: updatedBy,
      pendingApprovalTypeId: 'b4c27a6c-ab7c-4ce5-b885-997f9104c23d',
      approvedApprovalTypeId: 'approved-type',
    }));
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('updates the request timestamp when an approval step is approved but others remain pending', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: approvalId, APPROVER_ID: updatedBy, APPROVAL_STEP: 1 }])
      .mockResolvedValueOnce([{ ID: 'approved-type' }])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([{ TOTAL: 1 }]);

    await requestService.processApprovalAction(
      requestId,
      'approve',
      approvalPayload('approve'),
      updatedBy,
    );

    expect(requestUpdate).toHaveBeenCalledWith(
      { UPDATED_BY: updatedBy, UPDATED_DATE: { fn: 'GETDATE' } },
      { where: { ID: requestId, ENABLED: true }, transaction },
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('disables all enabled approvals before moving the request back to draft', async () => {
    database.query.mockResolvedValueOnce([{ ID: approvalId }]);

    await requestService.processApprovalAction(
      requestId,
      'backward',
      approvalPayload('backward'),
      updatedBy,
    );

    expect(approvalUpdate).toHaveBeenCalledWith(
      {
        APPROVAL_TYPE_ID: 'b76065cc-6507-458d-94ce-87231cbaa57c',
        DESCRIPTION: 'Reviewed',
        UPDATED_BY: updatedBy,
        UPDATED_DATE: { fn: 'GETDATE' },
      },
      {
        where: { ID: approvalId, REQUEST_ID: requestId, ENABLED: true },
        transaction,
      },
    );
    expect(approvalUpdate).toHaveBeenCalledWith(
      {
        ENABLED: false,
        UPDATED_BY: updatedBy,
        UPDATED_DATE: { fn: 'GETDATE' },
      },
      {
        where: { REQUEST_ID: requestId, ENABLED: true },
        transaction,
      },
    );
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        STATUS_ID: 'db8b3768-8466-4974-8dff-4c374b16a639',
        CANCELLED_NOTES: 'Reviewed',
      }),
      expect.objectContaining({ where: { ID: requestId, ENABLED: true }, transaction }),
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rejects the request while retaining other pending approvals', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: approvalId }])
      .mockResolvedValueOnce([{ ID: 'rejected-type' }]);

    await requestService.processApprovalAction(
      requestId,
      'reject',
      approvalPayload('reject'),
      updatedBy,
    );

    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ STATUS_ID: rejectedStatusId }),
      expect.objectContaining({ where: { ID: requestId, ENABLED: true }, transaction }),
    );
    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it('rejects an approval ID that is not pending and assigned to the user', async () => {
    database.query.mockResolvedValueOnce([]);

    await expect(requestService.processApprovalAction(
      requestId,
      'save',
      approvalPayload(),
      updatedBy,
    )).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    expect(approvalUpdate).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid boolean values before opening a transaction', async () => {
    const payload = approvalPayload();
    payload.IS_PERMANENT = 'false';

    await expect(requestService.processApprovalAction(
      requestId,
      'save',
      payload,
      updatedBy,
    )).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('keeps the previous approval movement unchanged when completing a final request', async () => {
    database.query
      .mockResolvedValueOnce([{ ID: requestId }])
      .mockResolvedValueOnce([{
        LIMIT_AMOUNT: 250000,
        TERM_ID: 'approved-term',
        RATING_ID: 'approved-rating',
        VALID_FROM: '2026-09-01',
        VALID_TO: '2026-09-30',
        DESCRIPTION: 'Final approved note',
        IS_PERMANENT: false,
        IS_TEMPORARY: true,
      }]);

    await requestService.processApprovalAction(
      requestId,
      'finalConfirm',
      {
        ...approvalPayload('finalConfirm'),
        DESCRIPTION: 'Final approved note',
        LIMIT_AMOUNT: 250000,
        TERM_ID: 'approved-term',
        RATING_ID: 'approved-rating',
        VALID_FROM: '2026-09-01',
        VALID_TO: '2026-09-30',
        IS_PERMANENT: false,
        IS_TEMPORARY: true,
        IS_CLEAR_OUTSTANDING_BALANCE: true,
        IS_WITHIN_APPROVED_LIMIT: false,
        IS_BANK_GUARANTEE: false,
        BANK_GUARANTEE_AMOUNT: 0,
        IS_CASH_DEPOSIT: true,
        CASH_DEPOSIT_AMOUNT: 1200,
      },
      updatedBy,
    );

    expect(database.query.mock.calls[0][0]).toContain(
      'TRY_CONVERT(BIGINT, TB1.SUBMITTED_BY) = TRY_CONVERT(BIGINT, :updatedBy)',
    );
    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        STATUS_ID: completedStatusId,
        APPROVED_LIMIT_AMOUNT: 250000,
        APPROVED_TERM_ID: 'approved-term',
        APPROVED_RATING_ID: 'approved-rating',
        APPROVED_VALID_FROM: expect.objectContaining({ fn: 'DATEFROMPARTS' }),
        APPROVED_VALID_TO: expect.objectContaining({ fn: 'DATEFROMPARTS' }),
        APPROVED_NOTES: 'Final approved note',
        IS_PERMANENT_APPROVED: false,
        IS_TEMPORARY_APPROVED: true,
      }),
      expect.objectContaining({ transaction }),
    );
    expect(database.query).toHaveBeenCalledTimes(2);
    expect(database.query.mock.calls[1][0]).toContain('SELECT TOP 1');
    expect(database.query.mock.calls[1][0]).not.toContain('UPDATE APPROVALS');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('requires a comment when cancelling a final request', async () => {
    await expect(requestService.processApprovalAction(
      requestId,
      'finalCancel',
      { DESCRIPTION: '   ' },
      updatedBy,
    )).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid Final Confirm input before opening a transaction', async () => {
    await expect(requestService.processApprovalAction(
      requestId,
      'finalConfirm',
      { DESCRIPTION: '', IS_PERMANENT: 'invalid' },
      updatedBy,
    )).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });

    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('moves an authorized final cancellation to cancelled', async () => {
    const auditBy = 20221459;
    database.query.mockResolvedValueOnce([{ ID: requestId }]);

    await requestService.processApprovalAction(
      requestId,
      'finalCancel',
      { DESCRIPTION: 'Customer withdrew the request.' },
      updatedBy,
      false,
      auditBy,
    );

    expect(requestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ STATUS_ID: cancelledStatusId, UPDATED_BY: auditBy }),
      expect.objectContaining({ transaction }),
    );
    expect(database.query.mock.calls[0][1].replacements.updatedBy).toBe(updatedBy);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[0][0]).toContain(
      'TRY_CONVERT(BIGINT, TB1.SUBMITTED_BY) = TRY_CONVERT(BIGINT, :updatedBy)',
    );
  });

  it('does not issue a second rollback when Final processing has already closed the transaction', async () => {
    transaction.finished = 'rollback';
    database.query.mockResolvedValueOnce([{ ID: requestId }]);
    database.query.mockRejectedValueOnce(new Error('Final update failed'));

    await expect(requestService.processApprovalAction(
      requestId,
      'finalConfirm',
      approvalPayload('finalConfirm'),
      updatedBy,
    )).rejects.toThrow('Final update failed');

    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('preserves the original Final database error when rollback also fails', async () => {
    database.query.mockResolvedValueOnce([{ ID: requestId }]);
    database.query.mockRejectedValueOnce(new Error('Final update failed'));
    transaction.rollback.mockRejectedValueOnce(Object.assign(new Error('Rollback failed'), { code: 'EREQUEST' }));

    const error = await requestService.processApprovalAction(
      requestId,
      'finalConfirm',
      approvalPayload('finalConfirm'),
      updatedBy,
    ).catch((caughtError) => caughtError);

    expect(error.message).toBe('Final update failed');
    expect(error.rollbackError).toEqual({ message: 'Rollback failed', code: 'EREQUEST' });
  });
});

describe('requestService.submitRequest', () => {
  let database;
  let requestRecord;
  let transaction;
  let Customer;
  let CustomerLog;

  beforeEach(() => {
    transaction = {
      LOCK: { UPDATE: 'UPDATE' },
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    database = {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn(),
    };
    requestRecord = {
      STATUS_ID: 'db8b3768-8466-4974-8dff-4c374b16a639',
      update: jest.fn().mockResolvedValue(undefined),
    };
    const sequelize = { fn: jest.fn((name) => ({ fn: name })) };
    Customer = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
      sequelize,
    };
    CustomerLog = {
      create: jest.fn().mockResolvedValue(undefined),
      sequelize,
    };
    const Request = {
      findOne: jest.fn()
        .mockResolvedValueOnce(requestRecord)
        .mockResolvedValueOnce(null),
      sequelize,
    };

    getDatabase.mockReturnValue(database);
    getModels.mockReturnValue({
      Request,
      Customer,
      CustomerLog,
      Size: { findOne: jest.fn().mockResolvedValue({ ID: 'size-1' }) },
      Term: { findByPk: jest.fn().mockResolvedValue({ ID: 'term-1' }) },
      Rating: { findOne: jest.fn().mockResolvedValue({ ID: 'rating-1' }) },
    });
  });

  describe('requestService.updateRequestCustomerInfo', () => {
    it('creates a customer from the saved request when the tax number has 13 digits', async () => {
      const transaction = {
        LOCK: { UPDATE: 'UPDATE' },
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
      };
      const sequelize = { fn: jest.fn((name) => ({ fn: name })) };
      const requestRecord = {
        CUSTOMER_TAX_NO: '1234567890123',
        CUSTOMER_CUSTOMER_TYPE_INTER: 'Internal customer',
        CUSTOMER_BUSINESS_TYPE_EXTER: 'External business',
        update: jest.fn(async (values) => Object.assign(requestRecord, values)),
      };
      const Customer = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
        sequelize,
      };
      const Request = {
        findOne: jest.fn()
          .mockResolvedValueOnce(requestRecord)
          .mockResolvedValueOnce(null),
        sequelize,
      };
      getDatabase.mockReturnValue({ transaction: jest.fn().mockResolvedValue(transaction) });
      getModels.mockReturnValue({
        Customer,
        CustomerLog,
        Request,
        Size: { findOne: jest.fn().mockResolvedValue({ ID: 'size-1' }) },
      });

      await requestService.updateRequestCustomerInfo(requestId, {
        CUSTOMER_TAX_NO: '1234567890123',
        CUSTOMER_REGISTERED_DATE: '2026-01-02',
        CUSTOMER_REGISTERED_CAPITAL_AMOUNT: '1000000',
        CUSTOMER_DIRECTORS: 'Directors',
      }, updatedBy);

      expect(Customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          TAX_NO: '1234567890123',
          REGISTERED_DATE: { fn: 'DATEFROMPARTS' },
          REGISTERED_CAPITAL_AMOUNT: '1000000',
          CUSTOMER_TYPE_INTER: 'Internal customer',
          BUSINESS_TYPE_EXTER: 'External business',
          SIZE_ID: requestRecord.CUSTOMER_SIZE_ID,
          DIRECTORS: 'Directors',
          CREATED_DATE: { fn: 'GETDATE' },
          UPDATED_BY: updatedBy,
          CREATED_BY: updatedBy,
          ENABLED: '1',
        }),
        { transaction },
      );
      expect(CustomerLog.create).toHaveBeenCalledWith(expect.objectContaining({
        ID: expect.any(String),
        TAX_NO: '1234567890123',
        NAME: 'Customer created',
        LOG_TYPE_ID: expect.any(String),
        CUSTOMER_ID: expect.any(String),
        CATEGORY: 'customer.insert',
        CREATED_BY: updatedBy,
        UPDATED_BY: updatedBy,
        ENABLED: true,
      }), { transaction });
      expect(JSON.parse(CustomerLog.create.mock.calls[0][0].DESCRIPTION)).toMatchObject({
        operation: 'upsert',
        action: 'insert',
        source: 'all-requests.details.customer-save',
        requestId,
        customerId: expect.any(String),
        values: { REGISTERED_CAPITAL_AMOUNT: '1000000' },
      });
      expect(transaction.commit).toHaveBeenCalledTimes(1);
      expect(transaction.rollback).not.toHaveBeenCalled();
    });
  });

  it('accepts an empty submit step list for direct completion', async () => {
    await requestService.submitRequest(requestId, submitCommand([]), updatedBy);
    expect(requestRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ STATUS_ID: completedStatusId }),
      { transaction },
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(Customer.findOne).not.toHaveBeenCalled();
    expect(Customer.create).not.toHaveBeenCalled();
  });

  it('creates an enabled customer from request data when submitting with a 13-digit tax number', async () => {
    Object.assign(requestRecord, {
      CUSTOMER_TAX_NO: '1234567890123',
      CUSTOMER_REGISTERED_DATE: '2020-01-02',
      CUSTOMER_REGISTERED_CAPITAL_AMOUNT: '1000000',
      CUSTOMER_BUSINESS_TYPE_INTER: 'Internal business',
      CUSTOMER_CUSTOMER_TYPE_INTER: 'Internal customer',
      CUSTOMER_BUSINESS_TYPE_EXTER: 'External business',
      CUSTOMER_CUSTOMER_TYPE_EXTER: 'External customer',
      CUSTOMER_SIZE_ID: 'size-1',
      CUSTOMER_SHAREHOLDERS: 'Shareholders',
      CUSTOMER_DIRECTORS: 'Directors',
    });

    await requestService.submitRequest(requestId, submitCommand([]), updatedBy);

    expect(Customer.findOne).toHaveBeenCalledWith({
      where: { ENABLED: '1', TAX_NO: '1234567890123' },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    expect(Customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        TAX_NO: '1234567890123',
        REGISTERED_DATE: '2020-01-02',
        REGISTERED_CAPITAL_AMOUNT: '1000000',
        BUSINESS_TYPE_INTER: 'Internal business',
        CUSTOMER_TYPE_INTER: 'Internal customer',
        BUSINESS_TYPE_EXTER: 'External business',
        CUSTOMER_TYPE_EXTER: 'External customer',
        SIZE_ID: 'size-1',
        SHAREHOLDERS: 'Shareholders',
        DIRECTORS: 'Directors',
        CREATED_DATE: { fn: 'GETDATE' },
        UPDATED_BY: updatedBy,
        UPDATED_DATE: { fn: 'GETDATE' },
        CREATED_BY: updatedBy,
        ENABLED: '1',
      }),
      { transaction },
    );
    expect(CustomerLog.create).toHaveBeenCalledWith(expect.objectContaining({
      ID: expect.any(String),
      TAX_NO: '1234567890123',
      NAME: 'Customer created',
      LOG_TYPE_ID: expect.any(String),
      CUSTOMER_ID: expect.any(String),
      CATEGORY: 'customer.insert',
      CREATED_BY: updatedBy,
      UPDATED_BY: updatedBy,
      ENABLED: true,
    }), { transaction });
    expect(JSON.parse(CustomerLog.create.mock.calls[0][0].DESCRIPTION)).toMatchObject({
      operation: 'upsert',
      action: 'insert',
      source: 'all-requests.details.submit',
      requestId,
      customerId: expect.any(String),
      values: { REGISTERED_CAPITAL_AMOUNT: '1000000' },
    });
  });

  it('updates an enabled customer when the tax number already exists', async () => {
    const customerRecord = {
      ID: 'customer-1',
      TAX_NO: '1234567890123',
      ENABLED: '1',
      REGISTERED_CAPITAL_AMOUNT: '1000000',
      update: jest.fn().mockResolvedValue(undefined),
    };
    Customer.findOne.mockResolvedValue(customerRecord);
    Object.assign(requestRecord, {
      CUSTOMER_TAX_NO: '1234567890123',
      CUSTOMER_REGISTERED_CAPITAL_AMOUNT: '2500000',
      CUSTOMER_SIZE_ID: 'size-2',
    });

    await requestService.submitRequest(requestId, submitCommand([]), updatedBy);

    expect(Customer.create).not.toHaveBeenCalled();
    expect(customerRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        REGISTERED_CAPITAL_AMOUNT: '2500000',
        SIZE_ID: 'size-2',
        UPDATED_BY: updatedBy,
      }),
      { transaction },
    );
    expect(CustomerLog.create).toHaveBeenCalledWith(expect.objectContaining({
      ID: expect.any(String),
      TAX_NO: '1234567890123',
      NAME: 'Customer updated',
      LOG_TYPE_ID: expect.any(String),
      CUSTOMER_ID: 'customer-1',
      CATEGORY: 'customer.update',
      CREATED_BY: updatedBy,
      UPDATED_BY: updatedBy,
      ENABLED: true,
    }), { transaction });
    expect(JSON.parse(CustomerLog.create.mock.calls[0][0].DESCRIPTION)).toMatchObject({
      action: 'update',
      values: { REGISTERED_CAPITAL_AMOUNT: '2500000' },
    });
  });

  it('completes without approval steps when no approvers are selected', async () => {
    const command = submitCommand([]);
    command.requestedDetails.IS_TERM_REQUESTED = false;
    command.requestedDetails.IS_LIMIT_REQUESTED = false;
    command.creditSuggestion = {
      ...command.creditSuggestion,
      PROPOSED_LIMIT_AMOUNT: 0,
      PROPOSED_RATING_ID: 'rating-1',
    };

    await requestService.submitRequest(requestId, command, updatedBy);
    expect(requestRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        STATUS_ID: completedStatusId,
        APPROVED_RATING_ID: 'rating-1',
      }),
      { transaction },
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('rejects a submit step without an approver before opening a transaction', async () => {
    await expect(requestService.submitRequest(
      requestId,
      submitCommand([{ approverTypeId: 'type-1', approverId: '', approvalStep: 1, sorting: 1 }]),
      updatedBy,
    )).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(getDatabase().transaction).not.toHaveBeenCalled();
  });

  it('rejects non-contiguous approval sorting before opening a transaction', async () => {
    await expect(requestService.submitRequest(
      requestId,
      submitCommand([{ approverTypeId: 'type-1', approverId: '123', approvalStep: 1, sorting: 2 }]),
      updatedBy,
    )).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(getDatabase().transaction).not.toHaveBeenCalled();
  });

  it('saves and completes without creating approvals when term and limit are not included', async () => {
    const command = submitCommand([]);
    command.requestedDetails.IS_TERM_REQUESTED = false;
    command.requestedDetails.IS_LIMIT_REQUESTED = false;
    command.creditSuggestion = {
      ...command.creditSuggestion,
      PROPOSED_TERM_ID: 'term-1',
      PROPOSED_RATING_ID: 'rating-1',
      PROPOSED_NOTES: 'Completed without approval',
      IS_PERMANENT_PROPOSED: false,
      IS_TEMPORARY_PROPOSED: true,
      PROPOSED_VALID_FROM: '2026-09-14',
      PROPOSED_VALID_TO: '2026-09-30',
    };
    await requestService.submitRequest(requestId, command, updatedBy);

    expect(requestRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        STATUS_ID: '407e23f9-caf5-4c4a-801d-598cf437d1ae',
        IS_TERM_REQUESTED: false,
        IS_LIMIT_REQUESTED: false,
        IS_TERM_PROPOSED: true,
        IS_LIMIT_PROPOSED: true,
        APPROVED_LIMIT_AMOUNT: 100000,
        APPROVED_TERM_ID: 'term-1',
        APPROVED_RATING_ID: 'rating-1',
        IS_LIMIT_APPROVED: true,
        IS_TERM_APPROVED: true,
        APPROVED_VALID_FROM: { fn: 'DATEFROMPARTS' },
        APPROVED_VALID_TO: { fn: 'DATEFROMPARTS' },
        APPROVED_NOTES: 'Completed without approval',
        IS_PERMANENT_APPROVED: false,
        IS_TEMPORARY_APPROVED: true,
        SUBMITTED_BY: updatedBy,
      }),
      { transaction },
    );
    expect(database.query).not.toHaveBeenCalled();
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('persists ordered approval rows from the current unsaved values', async () => {
    const command = submitCommand([{
      approverTypeId: 'type-1', approverId: '456', approvalStep: 1, sorting: 1,
    }]);
    command.bdsReviewApproverId = '456';
    command.creditSuggestion = {
      ...command.creditSuggestion,
      PROPOSED_TERM_ID: 'term-1',
      PROPOSED_RATING_ID: 'rating-1',
      PROPOSED_NOTES: 'Current unsaved note',
      IS_PERMANENT_PROPOSED: false,
      IS_TEMPORARY_PROPOSED: true,
      PROPOSED_VALID_FROM: '2026-09-14',
      PROPOSED_VALID_TO: '2026-09-30',
      IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED: true,
      IS_WITHIN_APPROVED_LIMIT_PROPOSED: false,
      IS_BANK_GUARANTEE_PROPOSED: false,
      PROPOSED_BANK_GUARANTEE_AMOUNT: 0,
      IS_CASH_DEPOSIT_PROPOSED: false,
      PROPOSED_CASH_DEPOSIT_AMOUNT: 0,
    };
    database.query
      .mockResolvedValueOnce([{ ID: 'type-1' }])
      .mockResolvedValueOnce([{ EMP_CODE: 456 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await requestService.submitRequest(requestId, command, updatedBy);

    const insertCall = database.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO APPROVALS'));
    expect(insertCall[1].replacements).toEqual(expect.objectContaining({
      requestId,
      approverTypeId: 'type-1',
      approvalTypeId: 'b4c27a6c-ab7c-4ce5-b885-997f9104c23d',
      approverId: '456',
      description: '',
      limitAmount: 100000,
      termId: 'term-1',
      validFrom: '2026-09-14',
      validTo: '2026-09-30',
      approvalStep: 1,
      sorting: 1,
      updatedBy,
    }));
    expect(requestRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        STATUS_ID: '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b',
        SUBMITTED_BY: 456,
      }),
      { transaction },
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('creates an approval workflow for a suggested-rating-only submission', async () => {
    const command = submitCommand([{
      approverTypeId: 'type-1', approverId: '456', approvalStep: 1, sorting: 1,
    }]);
    command.requestedDetails.IS_TERM_REQUESTED = false;
    command.requestedDetails.IS_LIMIT_REQUESTED = false;
    command.creditSuggestion = {
      ...command.creditSuggestion,
      PROPOSED_LIMIT_AMOUNT: 0,
      PROPOSED_RATING_ID: 'rating-1',
    };
    database.query
      .mockResolvedValueOnce([{ ID: 'type-1' }])
      .mockResolvedValueOnce([{ EMP_CODE: 456 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await requestService.submitRequest(requestId, command, updatedBy);

    expect(requestRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        STATUS_ID: '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b',
        IS_TERM_REQUESTED: false,
        IS_LIMIT_REQUESTED: false,
        IS_TERM_PROPOSED: false,
        IS_LIMIT_PROPOSED: false,
      }),
      { transaction },
    );
    const insertCall = database.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO APPROVALS'));
    expect(insertCall[1].replacements).toEqual(expect.objectContaining({
      ratingId: 'rating-1',
      limitAmount: null,
      termId: null,
    }));
  });

  it('rolls back request changes when approval insertion fails', async () => {
    const command = submitCommand([{
      approverTypeId: 'type-1', approverId: '456', approvalStep: 1, sorting: 1,
    }]);
    database.query
      .mockResolvedValueOnce([{ ID: 'type-1' }])
      .mockResolvedValueOnce([{ EMP_CODE: 456 }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('insert failed'));

    await expect(requestService.submitRequest(requestId, command, updatedBy))
      .rejects.toThrow('insert failed');

    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});
