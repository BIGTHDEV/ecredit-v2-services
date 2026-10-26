/* eslint-env jest */

jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));

const { getDatabase } = require('../config/database');

const {
  pendingApprovers,
  bdsReviewApprovers,
  resolveRecipients,
  getCompletedEmailContext,
  resolveCompletedEmailRecipients,
  buildApprovalSubject,
  buildCompletedSubject,
  buildCancelledSubject,
  buildRejectedSubject,
} = require('../services/requestWorkflowNotificationService');

function approval(overrides = {}) {
  return {
    APPROVER_TYPE_NAME: 'Manager Approve',
    APPROVAL_TYPE_NAME: 'Pending',
    APPROVAL_STEP: 1,
    APPROVER_NAME: 'FIRST-APPROVER',
    APPROVER_EMAIL: 'first@example.com',
    CURRENT_CYCLE: true,
    ...overrides,
  };
}

describe('request workflow notification recipients', () => {
  it('builds the requested approval subject from customer and company code', () => {
    expect(buildApprovalSubject({
      companyName: 'Benchmark Electronics (Thailand)PCL.',
      salesGroup: '200 - MG',
    })).toBe('New Submitting for your approval Benchmark Electronics (Thailand)PCL. (200 - MG)');
  });

  it('builds the completed subject from customer and sales group', () => {
    expect(buildCompletedSubject({
      companyName: 'Pentel Co., Ltd.',
      salesGroup: '100 - TGEE',
    })).toBe('Completed for your requested Pentel Co., Ltd. (100 - TGEE)');
  });

  it('builds the cancelled subject from company name and sales group', () => {
    expect(buildCancelledSubject({
      companyName: 'Pentel Co., Ltd.',
      salesGroup: '100 - TGEE',
    })).toBe('Request was cancelled Pentel Co., Ltd. (100 - TGEE)');
  });

  it('builds the rejected subject from company name and sales group', () => {
    expect(buildRejectedSubject({
      companyName: 'Pentel Co., Ltd.',
      salesGroup: '100 - TGEE',
    })).toBe('Request was rejected Pentel Co., Ltd. (100 - TGEE)');
  });

  it('groups all pending approvers from the first pending step', () => {
    const history = [
      approval(),
      approval({ APPROVER_NAME: 'SECOND-APPROVER', APPROVER_EMAIL: 'second@example.com' }),
      approval({ APPROVAL_STEP: 2, APPROVER_NAME: 'LATER-APPROVER', APPROVER_EMAIL: 'later@example.com' }),
    ];

    expect(pendingApprovers(history)).toHaveLength(2);
    expect(resolveRecipients('submit', history, {}).toRecords).toEqual([
      { email: 'first@example.com', name: 'FIRST-APPROVER' },
      { email: 'second@example.com', name: 'SECOND-APPROVER' },
    ]);
  });

  it('selects only current-cycle BDS Review approvers from step 2', () => {
    const history = [
      approval({
        APPROVAL_STEP: 2,
        APPROVER_TYPE_NAME: 'Manager Approve (BDS)',
        APPROVER_NAME: 'BDS-APPROVER',
        APPROVER_EMAIL: 'bds@example.com',
        APPROVAL_TYPE_NAME: 'Approved',
      }),
      approval({
        APPROVAL_STEP: 2,
        APPROVER_TYPE_NAME: 'Manager Approve (Finance)',
        APPROVER_NAME: 'FINANCE-APPROVER',
        APPROVER_EMAIL: 'finance@example.com',
        APPROVAL_TYPE_NAME: 'Approved',
      }),
      approval({
        APPROVAL_STEP: 2,
        APPROVER_TYPE_NAME: 'Manager Approve (BDS)',
        APPROVER_NAME: 'OLD-BDS-APPROVER',
        APPROVER_EMAIL: 'old-bds@example.com',
        APPROVAL_TYPE_NAME: 'Approved',
        CURRENT_CYCLE: false,
      }),
    ];

    expect(bdsReviewApprovers(history)).toEqual([history[0]]);
    expect(resolveRecipients('final', history, {}).toRecords).toEqual([
      { email: 'bds@example.com', name: 'BDS-APPROVER' },
    ]);
  });

  it('loads the requester manager, Super Users, and Final included selections for completed email', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{
        MANAGER_REQUESTER: 'manager@example.com',
        IS_TERM_APPROVED: true,
        IS_LIMIT_APPROVED: false,
        APPROVED_RATING_ID: 'rating-1',
      }])
      .mockResolvedValueOnce([{ EMAIL: 'super@example.com', NAME: 'SUPER-USER' }])
      .mockResolvedValueOnce([
        { EMAIL: 'bds@example.com', NAME: 'BDS' },
        { EMAIL: 'section@example.com', NAME: 'SECTION' },
        { EMAIL: 'finance@example.com', NAME: 'FINANCE' },
      ]);
    getDatabase.mockReturnValue({ query });

    await expect(getCompletedEmailContext('request-1')).resolves.toEqual({
      managerRequesterEmail: 'manager@example.com',
      superUserRecipients: [{ email: 'super@example.com', name: 'SUPER-USER' }],
      approverTypeRecipients: [
        { email: 'bds@example.com', name: 'BDS' },
        { email: 'section@example.com', name: 'SECTION' },
        { email: 'finance@example.com', name: 'FINANCE' },
      ],
      ratingIncluded: true,
      termIncluded: true,
      limitIncluded: false,
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toContain('TB2.APPROVER_ID1 = TB3.EMP_CODE');
    expect(query.mock.calls[0][0]).toContain('TB1.APPROVED_RATING_ID');
    expect(query.mock.calls[1][0]).toContain("LOWER(TB2.NAME) = 'super user'");
    expect(query.mock.calls[2][0]).toContain('FROM APPROVERS AS TB1');
    expect(query.mock.calls[2][0]).toContain("TB1.ENABLED = '1'");
    expect(query.mock.calls[2][0]).toContain('section manager approve (finance)');
  });

  it.each([
    ['Rating only', false, false, false],
    ['Rating with Term', true, false, true],
    ['Rating with Limit', false, true, true],
  ])('uses the completed email CC list for %s', (caseName, termIncluded, limitIncluded, includeBilling) => {
    const history = [
      approval({ APPROVER_TYPE_NAME: 'Requester', APPROVER_NAME: 'REQUESTER', APPROVER_EMAIL: 'requester@example.com' }),
      approval({ APPROVAL_STEP: 2, APPROVER_TYPE_NAME: 'Manager Approve (BDS)', APPROVER_NAME: 'BDS', APPROVER_EMAIL: 'bds@example.com' }),
    ];
    const inAppRecipients = resolveRecipients('completed', history, {});
    const emailRecipients = resolveCompletedEmailRecipients(inAppRecipients, {
      managerRequesterEmail: 'manager@example.com',
      superUserRecipients: [{ email: 'super@example.com', name: 'SUPER-USER' }],
      approverTypeRecipients: [
        { email: 'bds@example.com', name: 'BDS' },
        { email: 'section@example.com', name: 'SECTION' },
        { email: 'finance@example.com', name: 'FINANCE' },
      ],
      ratingIncluded: true,
      termIncluded,
      limitIncluded,
    });

    expect(emailRecipients.toRecords).toEqual([{ email: 'requester@example.com', name: 'REQUESTER' }]);
    expect(emailRecipients.ccRecords.map((record) => record.email)).toEqual([
      'manager@example.com',
      'super@example.com',
      'bds@example.com',
      'section@example.com',
      'finance@example.com',
      ...(includeBilling ? ['billing_team@bigth.com'] : []),
    ]);
    expect(inAppRecipients.ccRecords.map((record) => record.email)).toEqual(['bds@example.com']);
  });

  it('sends rejection to the requester and copies prior approved approvers', () => {
    const history = [
      {
        APPROVER_TYPE_NAME: 'Requester',
        APPROVER_NAME: 'REQUESTER',
        APPROVER_EMAIL: 'requester@example.com',
        CURRENT_CYCLE: true,
      },
      approval({ APPROVAL_TYPE_NAME: 'Approved', APPROVER_NAME: 'PRIOR', APPROVER_EMAIL: 'prior@example.com' }),
      approval({ APPROVAL_TYPE_NAME: 'Rejected', APPROVER_NAME: 'ACTOR', APPROVER_EMAIL: 'actor@example.com' }),
    ];

    expect(resolveRecipients('reject', history, {
      email: 'actor@example.com',
      displayName: 'ACTOR',
    })).toEqual({
      toRecords: [{ email: 'requester@example.com', name: 'REQUESTER' }],
      ccRecords: [
        { email: 'prior@example.com', name: 'PRIOR' },
        { email: 'actor@example.com', name: 'ACTOR' },
      ],
      dear: 'REQUESTER',
    });
  });

  it('sends cancellation to the requester and copies all current-cycle approvers', () => {
    const history = [
      {
        APPROVER_TYPE_NAME: 'Requester',
        APPROVER_NAME: 'REQUESTER',
        APPROVER_EMAIL: 'requester@example.com',
        CURRENT_CYCLE: true,
      },
      approval({ APPROVER_NAME: 'FINANCE', APPROVER_EMAIL: 'finance@example.com' }),
      approval({
        APPROVER_TYPE_NAME: 'BDS Review',
        APPROVER_NAME: 'BDS',
        APPROVER_EMAIL: 'bds@example.com',
        APPROVAL_TYPE_NAME: 'Suggested',
      }),
    ];

    expect(resolveRecipients('cancel', history, { email: 'actor@example.com', displayName: 'ACTOR' })).toEqual({
      toRecords: [{ email: 'requester@example.com', name: 'REQUESTER' }],
      ccRecords: [
        { email: 'finance@example.com', name: 'FINANCE' },
        { email: 'bds@example.com', name: 'BDS' },
      ],
      dear: 'REQUESTER',
    });
  });
});
