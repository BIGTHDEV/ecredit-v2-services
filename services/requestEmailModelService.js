const { getModels } = require('../models');
const config = require('../config/env');

function isMissing(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function valueOrDash(value) {
  return isMissing(value) ? '-' : value;
}

function formatSalesGroup(value) {
  const salesGroups = {
    100: '100 - TGEE',
    200: '200 - MG',
    300: '300 - PG',
    999: '999 - Others',
  };
  return salesGroups[String(value ?? '').trim()] || '-';
}

function isEnabled(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function formatDate(value) {
  if (isMissing(value)) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function formatAdjustmentDate(value) {
  if (isMissing(value)) return '-';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let year;
  let month;
  let day;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '-';
    year = value.getUTCFullYear();
    month = value.getUTCMonth() + 1;
    day = value.getUTCDate();
  } else {
    const dateValue = String(value).trim();
    let match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      [, year, month, day] = match;
      year = Number(year);
      month = Number(month);
      day = Number(day);
    } else {
      match = dateValue.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
      if (match) {
        day = Number(match[1]);
        month = months.findIndex((name) => name.toLowerCase() === match[2].toLowerCase()) + 1;
        year = Number(match[3]);
      } else {
        match = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (match) {
          day = Number(match[1]);
          month = Number(match[2]);
          year = Number(match[3]);
        } else {
          const parsedDate = new Date(value);
          if (Number.isNaN(parsedDate.getTime())) return '-';
          year = parsedDate.getUTCFullYear();
          month = parsedDate.getUTCMonth() + 1;
          day = parsedDate.getUTCDate();
        }
      }
    }
  }

  const validatedDate = new Date(Date.UTC(year, month - 1, day));
  if (validatedDate.getUTCFullYear() !== year
    || validatedDate.getUTCMonth() + 1 !== month
    || validatedDate.getUTCDate() !== day) return '-';
  return `${String(day).padStart(2, '0')} ${months[month - 1]} ${year}`;
}

function formatMoney(value) {
  if (isMissing(value)) return '-';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildRequestLink(requestId) {
  return `${config.frontendBaseUrl.replace(/\/$/, '')}/all-requests/${encodeURIComponent(requestId)}?tab=approver`;
}

function buildSalesforceLink(crmId) {
  if (isMissing(crmId)) return '';
  return `${config.salesforceBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(String(crmId).trim())}/view`;
}

function isCurrentCycle(value) {
  return value === true || value === 1 || value === '1';
}

function mapCreditDetailsMovements(history = []) {
  const groups = [];
  const groupsByKey = new Map();

  history.forEach((movement, index) => {
    const parallelKey = typeof movement.PARALLEL_KEYS === 'string' ? movement.PARALLEL_KEYS.trim() : '';
    const existingGroup = parallelKey ? groupsByKey.get(parallelKey) : undefined;
    const group = existingGroup || { displayStep: groups.length + 1, entries: [] };

    group.entries.push({ movement, index });
    if (!existingGroup) {
      groups.push(group);
      if (parallelKey) groupsByKey.set(parallelKey, group);
    }
  });

  return groups.flatMap((group) => group.entries.map(({ movement }) => ({
    displayStep: group.displayStep,
    step: group.displayStep,
    approverType: valueOrDash(movement.APPROVER_TYPE_NAME),
    approvalStatus: valueOrDash(movement.APPROVAL_TYPE_NAME),
    status: valueOrDash(movement.APPROVAL_TYPE_NAME),
    approver: valueOrDash(movement.APPROVER_NAME),
    lastUpdatedBy: valueOrDash(movement.LAST_UPDATE_BY),
    lastUpdatedDate: valueOrDash(movement.LAST_UPDATE_DATE),
    comment: valueOrDash(movement.COMMENT),
    creditTerm: valueOrDash(movement.CREDIT_TERM),
    creditLimit: formatMoney(movement.CREDIT_LIMIT),
    creditRating: valueOrDash(movement.CREDIT_RATING),
    clearOutstandingBalance: valueOrDash(movement.INCLUDED_CLEAR_OUTSTANDING_BALANCE),
    clearOutstandingBalanceYes: movement.INCLUDED_CLEAR_OUTSTANDING_BALANCE === 'Yes',
    withinApprovedLimit: valueOrDash(movement.INCLUDED_WITHIN_APPROVED_LIMIT),
    withinApprovedLimitYes: movement.INCLUDED_WITHIN_APPROVED_LIMIT === 'Yes',
    bankGuarantee: valueOrDash(movement.INCLUDED_BANK_GUARANTEE),
    bankGuaranteeAmount: formatMoney(movement.BANK_GUARANTEE_AMOUNT),
    cashDeposit: valueOrDash(movement.INCLUDED_CASH_DEPOSIT),
    cashDepositAmount: formatMoney(movement.CASH_DEPOSIT_AMOUNT),
    permanent: valueOrDash(movement.PERMANENT),
    permanentYes: movement.PERMANENT === 'Yes',
    temporary: valueOrDash(movement.TEMPORARY),
    temporaryYes: movement.TEMPORARY === 'Yes',
    validFrom: formatAdjustmentDate(movement.VALID_FROM),
    validTo: formatAdjustmentDate(movement.VALID_TO),
    currentCycle: isCurrentCycle(movement.CURRENT_CYCLE),
    sorting: Number(movement.SORTING) || 0,
  })));
}

function selectCurrentStep(movements) {
  const currentCycleApprovals = movements.filter((movement) => movement.currentCycle);
  const rejected = currentCycleApprovals
    .filter((movement) => movement.approvalStatus === 'Rejected')
    .sort((left, right) => right.sorting - left.sorting)[0];
  if (rejected) return rejected;

  const pending = currentCycleApprovals
    .filter((movement) => movement.approvalStatus === 'Pending')
    .sort((left, right) => left.sorting - right.sorting)[0];
  return pending || currentCycleApprovals[currentCycleApprovals.length - 1] || movements[movements.length - 1] || null;
}

function selectLastActionedStep(movements, currentStep) {
  if (!currentStep) return null;
  if (currentStep.approvalStatus === 'Rejected') return currentStep;

  const previousSteps = movements
    .filter((movement) => movement.currentCycle && movement.sorting < currentStep.sorting)
    .sort((left, right) => right.sorting - left.sorting);
  return previousSteps[0] || currentStep;
}

function mapCreditDetailsSummary(movements, currentStep, lastActionedStep) {
  return movements.map((movement) => ({
    stepName: movement.approverType,
    step: movement.step,
    approver: movement.approver,
    status: movement.status,
    isCurrentStep: Boolean(currentStep && movement.sorting === currentStep.sorting),
    isLastActionedStep: Boolean(lastActionedStep && movement === lastActionedStep),
    ...(movement.approvalStatus === 'Rejected' ? { isRejectedStep: true } : {}),
  }));
}

function emptyCreditDetailsMovement() {
  return {
    comment: '-',
    creditLimit: '-',
    creditTerm: '-',
    creditRating: '-',
    clearOutstandingBalance: '-',
    clearOutstandingBalanceYes: false,
    withinApprovedLimit: '-',
    withinApprovedLimitYes: false,
    bankGuarantee: '-',
    bankGuaranteeAmount: '-',
    cashDeposit: '-',
    cashDepositAmount: '-',
    temporary: '-',
    temporaryYes: false,
    permanent: '-',
    permanentYes: false,
    validFrom: '-',
    validTo: '-',
  };
}

function mapRequestToEmailModel(request, dear = '-', approvalHistory = []) {
  if (!request) throw new Error('Request was not found.');

  const scoringClassificationNa = isEnabled(request.IS_SCORING_NA);
  const scoringClassificationGovernment = isEnabled(request.IS_SCORING_GOVERMENT);
  const scoringClassificationOthers = isEnabled(request.IS_SCORING_OTHER);
  const clearOutstandingBalance = isEnabled(request.IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED);
  const withinApprovedLimit = isEnabled(request.IS_WITHIN_APPROVED_LIMIT_PROPOSED);
  const bankGuarantee = isEnabled(request.IS_BANK_GUARANTEE_PROPOSED);
  const cashDeposit = isEnabled(request.IS_CASH_DEPOSIT_PROPOSED);
  const creditDetailsMovements = mapCreditDetailsMovements(approvalHistory);
  const currentCycleApprovals = creditDetailsMovements.filter((movement) => movement.currentCycle && movement.sorting > 2);
  const suggestedCreditDetails = currentCycleApprovals[currentCycleApprovals.length - 1] || creditDetailsMovements[creditDetailsMovements.length - 1] || null;
  const approvedCreditMovement = currentCycleApprovals
    .filter((movement) => movement.approvalStatus === 'Approved')
    .sort((left, right) => right.sorting - left.sorting)[0] || null;
  const currentStep = selectCurrentStep(creditDetailsMovements);
  const lastActionedStep = selectLastActionedStep(creditDetailsMovements, currentStep);
  const finalActionedStep = currentStep && currentStep.approvalStatus === 'Approved'
    ? currentStep
    : lastActionedStep;
  const hideLastActionedDetails = Boolean(
    lastActionedStep && /BDS|Review/i.test(String(lastActionedStep.approverType || ''))
  );
  const finalConfirmedDetails = {
    comment: valueOrDash(request.APPROVED_NOTES),
    creditTerm: valueOrDash(request.approvedTerm?.NAME),
    creditLimit: formatMoney(request.APPROVED_LIMIT_AMOUNT),
    creditRating: valueOrDash(request.approvedRating?.NAME),
    temporaryYes: isEnabled(request.IS_TEMPORARY_APPROVED),
    permanentYes: isEnabled(request.IS_PERMANENT_APPROVED),
    validFrom: formatAdjustmentDate(request.APPROVED_VALID_FROM),
    validTo: formatAdjustmentDate(request.APPROVED_VALID_TO),
    clearOutstandingBalanceYes: approvedCreditMovement?.clearOutstandingBalanceYes || false,
    withinApprovedLimitYes: approvedCreditMovement?.withinApprovedLimitYes || false,
    bankGuaranteeAmount: approvedCreditMovement?.bankGuaranteeAmount || '-',
    cashDepositAmount: approvedCreditMovement?.cashDepositAmount || '-',
  };

  return {
    dear: valueOrDash(dear),
    link: buildRequestLink(request.ID),
    linkRequestNo: buildRequestLink(request.ID),
    requestNo: valueOrDash(request.NO),
    linkCrmNo: buildSalesforceLink(request.CRM_ID),
    crmNo: valueOrDash(request.CRM_NO),
    requestType: valueOrDash(request.REQUESTED_CUSTOMER_TYPE),
    companyName: valueOrDash(request.CUSTOMER_NAME_ENG),
    soldToNo: valueOrDash(request.SOLD_TO),
    salesGroup: formatSalesGroup(request.REQUESTED_SALES_GROUP),
    businessType: valueOrDash(request.CUSTOMER_BUSINESS_TYPE_INTER),
    customerType: valueOrDash(request.CUSTOMER_CUSTOMER_TYPE_EXTER),
    companyRegisterDate: formatDate(request.CUSTOMER_REGISTERED_DATE),
    registeredCapital: formatMoney(request.CUSTOMER_REGISTERED_CAPITAL_AMOUNT),
    companySize: valueOrDash(request.size?.NAME),
    creditRatingScore: valueOrDash(request.proposedRating?.NAME),
    creditRatingExisting: valueOrDash(request.existingRating?.NAME),
    creditRatingRequested: valueOrDash(request.requestedRating?.NAME),
    creditRatingProposed: valueOrDash(request.proposedRating?.NAME),
    profitability: valueOrDash(request.SCORING_PROFITABILITY),
    growth: valueOrDash(request.SCORING_GROWTH),
    liquidity: valueOrDash(request.SCORING_LIQUIDITY),
    leverage: valueOrDash(request.SCORING_LEVERAGE),
    existingProfitability: valueOrDash(request.EXISTING_PROFITABILITY),
    existingGrowth: valueOrDash(request.EXISTING_GROWTH),
    existingLiquidity: valueOrDash(request.EXISTING_LIQUIDITY),
    existingLeverage: valueOrDash(request.EXISTING_LEVERAGE),
    scoringNotes: valueOrDash(request.SCORING_NOTES),
    scoringClassificationNa,
    scoringClassificationGovernment,
    scoringClassificationOthers,
    showScoringClassification: scoringClassificationNa || scoringClassificationGovernment || scoringClassificationOthers,
    clearOutstandingBalance,
    withinApprovedLimit,
    bankGuarantee,
    cashDeposit,
    showAdditionalConditions: clearOutstandingBalance || withinApprovedLimit || bankGuarantee || cashDeposit,
    amountBank: formatMoney(request.PROPOSED_BANK_GUARANTEE_AMOUNT),
    amountDeposit: formatMoney(request.PROPOSED_CASH_DEPOSIT_AMOUNT),
    opinion: valueOrDash(request.PROPOSED_DISPLAYED_NOTES),
    creditTermExisting: valueOrDash(request.existingTerm?.NAME),
    creditTermRequested: valueOrDash(request.requestedTerm?.NAME),
    creditTermProposed: valueOrDash(request.proposedTerm?.NAME),
    creditTermApproved: valueOrDash(request.approvedTerm?.NAME),
    creditLimitExisting: formatMoney(request.EXISTING_LIMIT_AMOUNT),
    creditLimitRequested: formatMoney(request.REQUESTED_LIMIT_AMOUNT),
    creditLimitProposed: formatMoney(request.PROPOSED_LIMIT_AMOUNT),
    creditLimitApproved: formatMoney(request.APPROVED_LIMIT_AMOUNT),
    creditRatingApproved: valueOrDash(request.approvedRating?.NAME),
    approvedOpinion: valueOrDash(request.APPROVED_NOTES),
    cancelledNotes: valueOrDash(request.CANCELLED_NOTES),
    rejectedNotes: valueOrDash(request.CANCELLED_NOTES),
    backwardedNotes: valueOrDash(request.CANCELLED_NOTES),
    approvedCreditDetails: {
      ...finalConfirmedDetails,
      bankGuarantee: approvedCreditMovement?.bankGuarantee === 'Yes',
      cashDeposit: approvedCreditMovement?.cashDeposit === 'Yes',
      showAdditionalConditions: Boolean(
        approvedCreditMovement?.clearOutstandingBalanceYes
        || approvedCreditMovement?.withinApprovedLimitYes
        || approvedCreditMovement?.bankGuarantee === 'Yes'
        || approvedCreditMovement?.cashDeposit === 'Yes'
      ),
    },
    finalConfirmedDetails,
    creditDetailsMovements,
    creditDetailsSummary: mapCreditDetailsSummary(creditDetailsMovements, currentStep, lastActionedStep),
    suggestedCreditDetails: suggestedCreditDetails ? {
      creditTerm: suggestedCreditDetails.creditTerm,
      creditLimit: suggestedCreditDetails.creditLimit,
      creditRating: suggestedCreditDetails.creditRating,
      temporaryYes: suggestedCreditDetails.temporaryYes,
      permanentYes: suggestedCreditDetails.permanentYes,
      validFrom: suggestedCreditDetails.validFrom,
      validTo: suggestedCreditDetails.validTo,
    } : {
      creditTerm: '-',
      creditLimit: '-',
      creditRating: '-',
      temporaryYes: false,
      permanentYes: false,
      validFrom: '-',
      validTo: '-',
    },
    currentStep: currentStep || emptyCreditDetailsMovement(),
    lastActionedStep: lastActionedStep || emptyCreditDetailsMovement(),
    finalActionedStep: finalActionedStep || emptyCreditDetailsMovement(),
    hideLastActionedDetails,
  };
}

async function getRequestEmailModel(requestId, dear = '-', { transaction } = {}) {
  if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('requestId is required.');

  const { Request, Rating, Term, Size } = getModels();
  const request = await Request.findOne({
    where: { ID: requestId, ENABLED: true },
    ...(transaction ? { transaction } : {}),
    include: [
      { model: Size, as: 'size', attributes: ['ID', 'NAME'] },
      { model: Rating, as: 'existingRating', attributes: ['ID', 'NAME'] },
      { model: Rating, as: 'requestedRating', attributes: ['ID', 'NAME'] },
      { model: Rating, as: 'proposedRating', attributes: ['ID', 'NAME'] },
      { model: Term, as: 'existingTerm', attributes: ['ID', 'NAME'] },
      { model: Term, as: 'requestedTerm', attributes: ['ID', 'NAME'] },
      { model: Term, as: 'proposedTerm', attributes: ['ID', 'NAME'] },
      { model: Rating, as: 'approvedRating', attributes: ['ID', 'NAME'] },
      { model: Term, as: 'approvedTerm', attributes: ['ID', 'NAME'] },
    ],
  });

  const { listApprovalHistory } = require('./requestService');
  const approvalHistory = await listApprovalHistory(requestId, ...(transaction ? [{ transaction }] : []));
  return mapRequestToEmailModel(request, dear, approvalHistory);
}

module.exports = {
  formatDate,
  formatMoney,
  buildRequestLink,
  buildSalesforceLink,
  isCurrentCycle,
  mapCreditDetailsMovements,
  mapCreditDetailsSummary,
  mapRequestToEmailModel,
  getRequestEmailModel,
};
