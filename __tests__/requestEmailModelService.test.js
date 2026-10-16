/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../services/requestService', () => ({
  listApprovalHistory: jest.fn().mockResolvedValue([]),
}));
jest.mock('../config/env', () => ({
  frontendBaseUrl: 'https://ecredit-qas.bigth.com/',
  salesforceBaseUrl: 'https://bigcrm.my.salesforce.com/',
}));

const { getModels } = require('../models');
const { listApprovalHistory } = require('../services/requestService');
const {
  formatDate,
  formatMoney,
  buildRequestLink,
  buildSalesforceLink,
  mapRequestToEmailModel,
  mapCreditDetailsMovements,
  getRequestEmailModel,
} = require('../services/requestEmailModelService');

describe('requestEmailModelService', () => {
  test('reuses the scheduler transaction for request content and approval history', async () => {
    const transaction = { id: 'reminder-transaction' };
    const Request = { findOne: jest.fn().mockResolvedValue({ ID: 'request-1' }) };
    getModels.mockReturnValue({ Request });
    await getRequestEmailModel('request-1', 'Recipient', { transaction });
    expect(Request.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction }));
    expect(listApprovalHistory).toHaveBeenCalledWith('request-1', { transaction });
  });

  test('builds the request link from the environment base URL and request ID', () => {
    expect(buildRequestLink('request-1')).toBe('https://ecredit-qas.bigth.com/all-requests/request-1?tab=approver');
  });

  test('builds the Salesforce link from the environment base URL and CRM ID', () => {
    expect(buildSalesforceLink('15f13395-a4c3-4c66-abba-1551d20d56ea'))
      .toBe('https://bigcrm.my.salesforce.com/15f13395-a4c3-4c66-abba-1551d20d56ea');
  });

  test('formats dates and money for email output', () => {
    expect(formatDate('2026-09-22T00:00:00.000Z')).toBe('22/09/2026');
    expect(formatMoney('20000')).toBe('20,000.00');
    expect(formatMoney(null)).toBe('-');
  });

  test('maps the external customer type and request credit fields', () => {
    const model = mapRequestToEmailModel({
      ID: 'request-1',
      CRM_ID: '15f13395-a4c3-4c66-abba-1551d20d56ea',
      CRM_NO: 'CRM-0001',
      REQUESTED_CUSTOMER_TYPE: 'New',
      CUSTOMER_NAME_ENG: 'Acme',
      SOLD_TO: '100001',
      REQUESTED_SALES_GROUP: '200',
      CUSTOMER_BUSINESS_TYPE_INTER: 'Industry',
      CUSTOMER_CUSTOMER_TYPE_EXTER: 'External',
      CUSTOMER_REGISTERED_DATE: '2026-09-22',
      CUSTOMER_REGISTERED_CAPITAL_AMOUNT: '20000',
      size: { NAME: 'Large' },
      existingRating: { NAME: 'B' },
      requestedRating: { NAME: 'A-' },
      proposedRating: { NAME: 'A' },
      SCORING_PROFITABILITY: 'Good',
      SCORING_GROWTH: 'Good',
      SCORING_LIQUIDITY: 'Good',
      SCORING_LEVERAGE: 'Good',
      SCORING_NOTES: 'Strong financial profile',
      IS_SCORING_NA: false,
      IS_SCORING_GOVERMENT: true,
      IS_SCORING_OTHER: false,
      IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED: true,
      IS_WITHIN_APPROVED_LIMIT_PROPOSED: false,
      IS_BANK_GUARANTEE_PROPOSED: true,
      IS_CASH_DEPOSIT_PROPOSED: false,
      PROPOSED_BANK_GUARANTEE_AMOUNT: '1000',
      PROPOSED_CASH_DEPOSIT_AMOUNT: '2000',
      PROPOSED_NOTES: 'Approved',
      existingTerm: { NAME: '30 days' },
      requestedTerm: { NAME: '60 days' },
      proposedTerm: { NAME: '45 days' },
      EXISTING_LIMIT_AMOUNT: '10000',
      REQUESTED_LIMIT_AMOUNT: '20000',
      PROPOSED_LIMIT_AMOUNT: '15000',
      CANCELLED_NOTES: 'Please review the request details.',
    }, 'Approver');

    expect(model).toEqual(expect.objectContaining({
      dear: 'Approver',
      link: 'https://ecredit-qas.bigth.com/all-requests/request-1?tab=approver',
      linkRequestNo: 'https://ecredit-qas.bigth.com/all-requests/request-1?tab=approver',
      linkCrmNo: 'https://bigcrm.my.salesforce.com/15f13395-a4c3-4c66-abba-1551d20d56ea',
      salesGroup: '200 - MG',
      requestNo: '-',
      crmNo: 'CRM-0001',
      customerType: 'External',
      registeredCapital: '20,000.00',
      creditRatingScore: 'A',
      creditRatingExisting: 'B',
      creditRatingRequested: 'A-',
      creditRatingProposed: 'A',
      scoringNotes: 'Strong financial profile',
      scoringClassificationNa: false,
      scoringClassificationGovernment: true,
      scoringClassificationOthers: false,
      showScoringClassification: true,
      existingProfitability: '-',
      existingGrowth: '-',
      existingLiquidity: '-',
      existingLeverage: '-',
      clearOutstandingBalance: true,
      withinApprovedLimit: false,
      bankGuarantee: true,
      cashDeposit: false,
      showAdditionalConditions: true,
      creditLimitExisting: '10,000.00',
      creditLimitRequested: '20,000.00',
      creditLimitProposed: '15,000.00',
      cancelledNotes: 'Please review the request details.',
      backwardedNotes: 'Please review the request details.',
    }));
  });

  test('hides optional sections when all classification and condition flags are false', () => {
    const model = mapRequestToEmailModel({
      IS_SCORING_NA: false,
      IS_SCORING_GOVERMENT: false,
      IS_SCORING_OTHER: false,
      IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED: false,
      IS_WITHIN_APPROVED_LIMIT_PROPOSED: false,
      IS_BANK_GUARANTEE_PROPOSED: false,
      IS_CASH_DEPOSIT_PROPOSED: false,
    });

    expect(model.showScoringClassification).toBe(false);
    expect(model.showAdditionalConditions).toBe(false);
  });

  test('maps movement history in order and shares display steps for parallel approvals', () => {
    const movements = mapCreditDetailsMovements([
      { APPROVER_TYPE_NAME: 'Requester', APPROVAL_TYPE_NAME: 'Requested', APPROVER_NAME: 'BAE', LAST_UPDATE_BY: 'BAE', LAST_UPDATE_DATE: '1', CREDIT_TERM: '30 days', CREDIT_LIMIT: 250000, CREDIT_RATING: 'A', PARALLEL_KEYS: null },
      { APPROVER_TYPE_NAME: 'Manager Approve (BDS)', APPROVAL_TYPE_NAME: 'Approved', APPROVER_NAME: 'BDS', LAST_UPDATE_BY: 'BDS', LAST_UPDATE_DATE: '2', CREDIT_TERM: '30 days', CREDIT_LIMIT: 250000, CREDIT_RATING: 'A', PARALLEL_KEYS: 'manager' },
      { APPROVER_TYPE_NAME: 'Manager Approve (Finance)', APPROVAL_TYPE_NAME: 'Pending', APPROVER_NAME: 'Finance', LAST_UPDATE_BY: 'Finance', LAST_UPDATE_DATE: '3', CREDIT_TERM: '', CREDIT_LIMIT: null, CREDIT_RATING: '', PARALLEL_KEYS: 'manager' },
    ]);

    expect(movements).toEqual([
      expect.objectContaining({ displayStep: 1, approverType: 'Requester' }),
      expect.objectContaining({ displayStep: 2, approverType: 'Manager Approve (BDS)', creditLimit: '250,000.00' }),
      expect.objectContaining({ displayStep: 2, approverType: 'Manager Approve (Finance)', creditTerm: '-', creditLimit: '-', creditRating: '-' }),
    ]);
  });

  test('maps credit details, approval summary, and the pending current step', () => {
    const model = mapRequestToEmailModel({
      EXISTING_LIMIT_AMOUNT: 200000,
      PROPOSED_LIMIT_AMOUNT: 250000,
      existingTerm: { NAME: 'C030 - 30 days from invoice date' },
      proposedTerm: { NAME: 'S045 - 45 days from month of supply' },
      existingRating: { NAME: 'B (High)' },
      proposedRating: { NAME: 'B (Medium)' },
      APPROVED_NOTES: 'Final confirmed note',
      APPROVED_LIMIT_AMOUNT: 275000,
      APPROVED_VALID_FROM: '2026-09-01',
      APPROVED_VALID_TO: '2026-12-31',
      IS_TEMPORARY_APPROVED: true,
      IS_PERMANENT_APPROVED: false,
      approvedTerm: { NAME: 'C060 - 60 days from invoice date' },
      approvedRating: { NAME: 'A (Low Risk)' },
    }, '-', [
      { APPROVER_TYPE_NAME: 'Requester', APPROVAL_TYPE_NAME: 'Requested', APPROVER_NAME: 'BAE', SORTING: 1, CURRENT_CYCLE: true },
      { APPROVER_TYPE_NAME: 'Credit Team', APPROVAL_TYPE_NAME: 'Suggested', APPROVER_NAME: 'NUT', SORTING: 2, CURRENT_CYCLE: true, CREDIT_LIMIT: 250000, CREDIT_TERM: 'S045', CREDIT_RATING: 'B' },
      { APPROVER_TYPE_NAME: 'Manager Approve (Commercial)', APPROVAL_TYPE_NAME: 'Pending', APPROVER_NAME: 'NJ-NARONGRIT', SORTING: 3, CURRENT_CYCLE: true, CREDIT_LIMIT: 250000, CREDIT_TERM: 'C000 - 0 days cash on delivery', CREDIT_RATING: '', COMMENT: 'Comment Test', INCLUDED_CLEAR_OUTSTANDING_BALANCE: 'Yes', INCLUDED_WITHIN_APPROVED_LIMIT: 'Yes', INCLUDED_BANK_GUARANTEE: 'Yes', BANK_GUARANTEE_AMOUNT: 777771, INCLUDED_CASH_DEPOSIT: 'Yes', CASH_DEPOSIT_AMOUNT: 88882, TEMPORARY: 'Yes', PERMANENT: 'No', VALID_FROM: '06 Aug 2026, 12:00 AM', VALID_TO: '30 Aug 2026, 12:00 AM' },
    ]);

    expect(model.suggestedCreditDetails).toEqual({
      creditTerm: 'C000 - 0 days cash on delivery',
      creditLimit: '250,000.00',
      creditRating: '-',
      temporaryYes: true,
      permanentYes: false,
      validFrom: '06 Aug 2026, 12:00 AM',
      validTo: '30 Aug 2026, 12:00 AM',
    });
    expect(model.creditDetailsSummary).toEqual([
      { stepName: 'Requester', step: 1, approver: 'BAE', status: 'Requested', isCurrentStep: false, isLastActionedStep: false },
      { stepName: 'Credit Team', step: 2, approver: 'NUT', status: 'Suggested', isCurrentStep: false, isLastActionedStep: true },
      { stepName: 'Manager Approve (Commercial)', step: 3, approver: 'NJ-NARONGRIT', status: 'Pending', isCurrentStep: true, isLastActionedStep: false },
    ]);
    expect(model.currentStep).toEqual(expect.objectContaining({
      approver: 'NJ-NARONGRIT',
      comment: 'Comment Test',
      creditLimit: '250,000.00',
      creditTerm: 'C000 - 0 days cash on delivery',
      creditRating: '-',
      bankGuaranteeAmount: '777,771.00',
      cashDepositAmount: '88,882.00',
      clearOutstandingBalanceYes: true,
      withinApprovedLimitYes: true,
    }));
    expect(model.lastActionedStep).toEqual(expect.objectContaining({
      approver: 'NUT',
      clearOutstandingBalanceYes: false,
    }));
    expect(model.finalConfirmedDetails).toEqual(expect.objectContaining({
      comment: 'Final confirmed note',
      creditLimit: '275,000.00',
      creditTerm: 'C060 - 60 days from invoice date',
      creditRating: 'A (Low Risk)',
      temporaryYes: true,
      permanentYes: false,
      validFrom: '01/09/2026',
      validTo: '31/12/2026',
    }));
    expect(model.hideLastActionedDetails).toBe(false);
  });

  test('hides last-action details when the last actioned step was BDS Review', () => {
    const model = mapRequestToEmailModel({}, '-', [
      { APPROVER_TYPE_NAME: 'Requester', APPROVAL_TYPE_NAME: 'Requested', APPROVER_NAME: 'ANM-ANUSORNM', SORTING: 1, CURRENT_CYCLE: true },
      { APPROVER_TYPE_NAME: 'BDS Review', APPROVAL_TYPE_NAME: 'Suggested', APPROVER_NAME: 'NUC-NUTTAPONGC', SORTING: 2, CURRENT_CYCLE: true },
      { APPROVER_TYPE_NAME: 'Section Manager Approve (Finance)', APPROVAL_TYPE_NAME: 'Pending', APPROVER_NAME: 'TRP-TRIPORNP', SORTING: 3, CURRENT_CYCLE: true },
    ]);

    expect(model.lastActionedStep).toEqual(expect.objectContaining({ approverType: 'BDS Review' }));
    expect(model.hideLastActionedDetails).toBe(true);
  });

  test('uses the last approved movement for the Final email without changing the shared last action', () => {
    const model = mapRequestToEmailModel({}, '-', [
      { APPROVER_TYPE_NAME: 'Requester', APPROVAL_TYPE_NAME: 'Requested', APPROVER_NAME: 'BAE', SORTING: 1, CURRENT_CYCLE: true },
      { APPROVER_TYPE_NAME: 'Credit Team', APPROVAL_TYPE_NAME: 'Suggested', APPROVER_NAME: 'NUT', SORTING: 2, CURRENT_CYCLE: true },
      { APPROVER_TYPE_NAME: 'Section Manager Approve (Finance)', APPROVAL_TYPE_NAME: 'Approved', APPROVER_NAME: 'WI-WARINNEREEW', SORTING: 3, CURRENT_CYCLE: true },
      { APPROVER_TYPE_NAME: 'Manager Approve (Commercial)', APPROVAL_TYPE_NAME: 'Approved', APPROVER_NAME: 'NJ-NARONGRIT', SORTING: 4, CURRENT_CYCLE: true },
    ]);

    expect(model.lastActionedStep).toEqual(expect.objectContaining({ approver: 'WI-WARINNEREEW' }));
    expect(model.finalActionedStep).toEqual(expect.objectContaining({ approver: 'NJ-NARONGRIT' }));
  });

  test('keeps last-action details when the last actioned step was not BDS Review', () => {
    const model = mapRequestToEmailModel({}, '-', [
      { APPROVER_TYPE_NAME: 'Requester', APPROVAL_TYPE_NAME: 'Requested', APPROVER_NAME: 'ANM-ANUSORNM', SORTING: 1, CURRENT_CYCLE: true },
      { APPROVER_TYPE_NAME: 'Credit Team', APPROVAL_TYPE_NAME: 'Suggested', APPROVER_NAME: 'NUT', SORTING: 2, CURRENT_CYCLE: true },
      { APPROVER_TYPE_NAME: 'Section Manager Approve (Finance)', APPROVAL_TYPE_NAME: 'Pending', APPROVER_NAME: 'TRP-TRIPORNP', SORTING: 3, CURRENT_CYCLE: true },
    ]);

    expect(model.lastActionedStep).toEqual(expect.objectContaining({ approverType: 'Credit Team' }));
    expect(model.hideLastActionedDetails).toBe(false);
  });

  test('uses dash values for current step when approval history is empty', () => {
    const model = mapRequestToEmailModel({});

    expect(model.currentStep).toEqual(expect.objectContaining({
      comment: '-',
      creditLimit: '-',
      cashDepositAmount: '-',
    }));
    expect(model.suggestedCreditDetails).toEqual({
      creditTerm: '-',
      creditLimit: '-',
      creditRating: '-',
      temporaryYes: false,
      permanentYes: false,
      validFrom: '-',
      validTo: '-',
    });
    expect(model.creditDetailsSummary).toEqual([]);
  });

  test('loads a request with ORM associations', async () => {
    const request = { CUSTOMER_CUSTOMER_TYPE_EXTER: 'External' };
    const findOne = jest.fn().mockResolvedValue(request);
    const Request = { findOne };
    const Rating = { model: 'Rating' };
    const Term = { model: 'Term' };
    const Size = { model: 'Size' };
    getModels.mockReturnValue({ Request, Rating, Term, Size });

    await getRequestEmailModel('request-1', 'Approver');

    expect(listApprovalHistory).toHaveBeenCalledWith('request-1');

    expect(findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { ID: 'request-1', ENABLED: true },
      include: expect.arrayContaining([
        expect.objectContaining({ model: Size, as: 'size' }),
        expect.objectContaining({ model: Rating, as: 'existingRating' }),
        expect.objectContaining({ model: Rating, as: 'requestedRating' }),
        expect.objectContaining({ model: Rating, as: 'proposedRating' }),
        expect.objectContaining({ model: Term, as: 'existingTerm' }),
      ]),
    }));
  });
});
