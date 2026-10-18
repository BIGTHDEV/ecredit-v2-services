/* eslint-env jest */

jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));

const { getDatabase } = require('../config/database');
const { propagateApprovedValues } = require('../services/approvalWorkflowService');

describe('approvalWorkflowService.propagateApprovedValues', () => {
  it('propagates approved credit values without copying the approver comment', async () => {
    const database = { query: jest.fn().mockResolvedValue([1]) };
    const transaction = {};
    getDatabase.mockReturnValue(database);

    await propagateApprovedValues({
      requestId: 'request-1',
      approvalId: 'approval-1',
      approvalStep: 1,
      updatedBy: 1001,
      pendingApprovalTypeId: 'pending-type',
      approvedApprovalTypeId: 'approved-type',
      transaction,
    });

    const [query, options] = database.query.mock.calls[0];
    expect(query).not.toMatch(/\bDESCRIPTION\b/);
    expect(query).toContain('LIMIT_AMOUNT = TB2.LIMIT_AMOUNT');
    expect(options.transaction).toBe(transaction);
  });
});
