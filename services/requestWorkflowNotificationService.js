const logger = require('../config/logger');
const { listApprovalHistory } = require('./requestService');
const { getRequestEmailModel } = require('./requestEmailModelService');
const { sendRequestWorkflowEmail } = require('../emails/requestWorkflowEmail');
const config = require('../config/env');
const { createEmailApprovalToken } = require('./emailApprovalActionService');
const { createWorkflowNotifications } = require('./notificationService');
const { employeeCode, approvalAuditEmployeeCode } = require('../helpers/userIdentity');

function uniqueAddresses(records = []) {
    return [...new Set(records
        .map((record) => String(record?.email || '').trim().toLowerCase())
        .filter(Boolean))];
}

function uniqueNames(records = []) {
    return [...new Set(records.map((record) => String(record?.APPROVER_NAME || '').trim()).filter(Boolean))];
}

function recipient(email, name) {
    return { email, name };
}

function currentCycleHistory(history) {
    return history.filter((item) => item.CURRENT_CYCLE === true || item.CURRENT_CYCLE === 1 || item.CURRENT_CYCLE === '1');
}

function pendingApprovers(history) {
    const pending = currentCycleHistory(history).filter((item) => item.APPROVAL_TYPE_NAME === 'Pending');
    if (!pending.length) return [];
    const step = Math.min(...pending.map((item) => Number(item.APPROVAL_STEP) || Number(item.SORTING) || 0));
    const currentStep = pending.filter((item) => (Number(item.APPROVAL_STEP) || Number(item.SORTING) || 0) === step);
    const parallelKey = currentStep
        .map((item) => typeof item.PARALLEL_KEYS === 'string' ? item.PARALLEL_KEYS.trim() : '')
        .find(Boolean);
    return (parallelKey
        ? currentStep.filter((item) => String(item.PARALLEL_KEYS || '').trim() === parallelKey)
        : currentStep)
        .sort((left, right) => (Number(left.SORTING) || 0) - (Number(right.SORTING) || 0));
}

function isParallelApprovalIncomplete(history) {
    const currentCycle = currentCycleHistory(history);
    const pending = currentCycle.filter((item) => item.APPROVAL_TYPE_NAME === 'Pending');
    if (!pending.length) return false;

    const step = Math.min(...pending.map((item) => Number(item.APPROVAL_STEP) || Number(item.SORTING) || 0));
    const currentStepPending = pending.filter((item) => (Number(item.APPROVAL_STEP) || Number(item.SORTING) || 0) === step);
    const parallelKey = currentStepPending
        .map((item) => typeof item.PARALLEL_KEYS === 'string' ? item.PARALLEL_KEYS.trim() : '')
        .find(Boolean);
    if (!parallelKey) return false;

    const parallelApprovals = currentCycle.filter((item) => (
        (Number(item.APPROVAL_STEP) || Number(item.SORTING) || 0) === step
        && String(item.PARALLEL_KEYS || '').trim() === parallelKey
    ));
    return parallelApprovals.some((item) => item.APPROVAL_TYPE_NAME === 'Pending')
        && parallelApprovals.some((item) => item.APPROVAL_TYPE_NAME === 'Approved');
}

function submitter(history) {
    return history.find((item) => item.APPROVER_TYPE_NAME === 'Requester');
}

function previousActioners(history) {
    return currentCycleHistory(history).filter((item) => item.APPROVAL_TYPE_NAME === 'Approved');
}

function bdsReviewApprovers(history) {
    return currentCycleHistory(history).filter((item) => (
        Number(item.APPROVAL_STEP) === 2
        && /BDS|Review/i.test(String(item.APPROVER_TYPE_NAME || ''))
    ));
}

function allApprovers(history) {
    return currentCycleHistory(history).filter((item) => (
        !/Requester/i.test(String(item.APPROVER_TYPE_NAME || ''))
        && String(item.APPROVER_EMAIL || '').trim()
    ));
}

function backwardRecipients(history) {
    const bdsApprovers = bdsReviewApprovers(history);
    const backwardApprovers = currentCycleHistory(history).filter((item) => (
        item.APPROVAL_TYPE_NAME === 'Backward'
        && !/Requester/i.test(String(item.APPROVER_TYPE_NAME || ''))
        && String(item.APPROVER_EMAIL || '').trim()
    ));
    return {
        toRecords: bdsApprovers.map((item) => recipient(item.APPROVER_EMAIL, item.APPROVER_NAME)),
        ccRecords: backwardApprovers.map((item) => recipient(item.APPROVER_EMAIL, item.APPROVER_NAME)),
        dear: uniqueNames(bdsApprovers).join(', ') || 'All',
    };
}

function resolveRecipients(event, history, actor) {
    if (event === 'submit' || event === 'approve') {
        const approvers = pendingApprovers(history);
        return {
            toRecords: approvers.map((item) => recipient(item.APPROVER_EMAIL, item.APPROVER_NAME)),
            ccRecords: [],
            dear: uniqueNames(approvers).join(', ') || 'All',
        };
    }

    if (event === 'final') {
        const approvers = bdsReviewApprovers(history);
        return {
            toRecords: approvers.map((item) => recipient(item.APPROVER_EMAIL, item.APPROVER_NAME)),
            ccRecords: [],
            dear: uniqueNames(approvers).join(', ') || 'All',
        };
    }

    if (event === 'backward') {
        return backwardRecipients(history);
    }

    if (event === 'cancel' || event === 'final-cancel') {
        const requester = submitter(history);
        return {
            toRecords: requester ? [recipient(requester.APPROVER_EMAIL, requester.APPROVER_NAME)] : [],
            ccRecords: allApprovers(history).map((item) => recipient(item.APPROVER_EMAIL, item.APPROVER_NAME)),
            dear: requester?.APPROVER_NAME || 'All',
        };
    }

    if (event === 'completed') {
        const requester = submitter(history);
        const bdsApprovers = bdsReviewApprovers(history);
        return {
            toRecords: requester ? [recipient(requester.APPROVER_EMAIL, requester.APPROVER_NAME)] : [],
            ccRecords: bdsApprovers.map((item) => recipient(item.APPROVER_EMAIL, item.APPROVER_NAME)),
            dear: requester?.APPROVER_NAME || 'All',
        };
    }

    if (event === 'reject') {
        const requester = submitter(history);
        return {
            toRecords: requester ? [recipient(requester.APPROVER_EMAIL, requester.APPROVER_NAME)] : [],
            ccRecords: [
                ...previousActioners(history)
                    .filter((item) => !/Requester/i.test(String(item.APPROVER_TYPE_NAME || '')))
                    .map((item) => recipient(item.APPROVER_EMAIL, item.APPROVER_NAME)),
                recipient(actor?.email, actor?.displayName || actor?.name),
            ],
            dear: requester?.APPROVER_NAME || 'All',
        };
    }

    const toRecords = [submitter(history), ...previousActioners(history)]
        .filter(Boolean)
        .map((item) => recipient(item.APPROVER_EMAIL, item.APPROVER_NAME));
    return {
        toRecords,
        ccRecords: [recipient(actor?.email, actor?.displayName || actor?.name)],
        dear: (actor?.name || actor?.displayName) || 'All',
    };
}

const EVENT_CONFIG = {
    submit: { template: 'request-approval.hbs' },
    approve: { template: 'request-approval.hbs' },
    final: { template: 'request-final.hbs', subject: 'Request approved by all approvers' },
    completed: { template: 'request-completed.hbs', subject: 'Request was completed' },
    reject: { template: 'request-rejected.hbs', subject: 'Request was rejected' },
    backward: { template: 'request-backward.hbs', subject: 'Request was sent backward' },
    cancel: { template: 'request-cancelled.hbs', subject: 'Request was cancelled' },
    'final-cancel': { template: 'request-cancelled.hbs', subject: 'Request was cancelled' },
};

function buildApprovalSubject(emailModel) {
    return `New Submitting for your approval ${emailModel.companyName} (${emailModel.salesGroup})`;
}

function buildCompletedSubject(emailModel) {
    return `Completed for your requested ${emailModel.companyName} (${emailModel.salesGroup})`;
}

function buildCancelledSubject(emailModel) {
    return `Request was cancelled ${emailModel.companyName} (${emailModel.salesGroup})`;
}

function buildRejectedSubject(emailModel) {
    return `Request was rejected ${emailModel.companyName} (${emailModel.salesGroup})`;
}

function buildBackwardSubject(emailModel) {
    return `Request was sent backward ${emailModel.companyName} (${emailModel.salesGroup})`;
}

function approvalActionsFor(requestId, approvers) {
    return approvers.map((approval) => {
        const actionLinks = ['approve', 'reject'];
        if (approval.ALLOW_BACKWARD === true || approval.ALLOW_BACKWARD === 1 || approval.ALLOW_BACKWARD === '1') {
            actionLinks.unshift('backward');
        }
        return actionLinks.map((action) => ({
            label: action.charAt(0).toUpperCase() + action.slice(1),
            action,
            backgroundColor: action === 'backward' ? '#adb5bd' : action === 'approve' ? '#008000' : '#D73925',
            textColor: action === 'backward' ? '#212529' : '#F1F1F1',
            url: `${config.frontendBaseUrl.replace(/\/$/, '')}/email-approval/${encodeURIComponent(createEmailApprovalToken({
                requestId,
                approvalId: approval.ID,
                approverId: approval.APPROVER_ID,
                action,
            }))}`,
        }));
    }).flat();
}

async function sendRequestWorkflowNotification({ event, requestId, environment, actorEmail, actorName, user, transporter, auditActorCode }) {
    const eventConfig = EVENT_CONFIG[event];
    if (!eventConfig) throw new Error(`Unsupported workflow email event: ${event}`);
    const normalizedEnvironment = String(environment || '').trim().toLowerCase();

    const history = event === 'backward'
        ? await listApprovalHistory(requestId, { includeDisabledApprovals: true })
        : await listApprovalHistory(requestId);
    if (event === 'approve' && isParallelApprovalIncomplete(history)) {
        return { skipped: true, reason: 'Parallel approval is incomplete' };
    }
    const actor = { email: actorEmail, displayName: actorName };
    const resolved = resolveRecipients(event, history, actor);
    const approvalApprovers = event === 'submit' || event === 'approve'
        ? pendingApprovers(history).filter((item) => String(item.APPROVER_EMAIL || '').trim())
        : [];
    const recipients = {
        to: uniqueAddresses(resolved.toRecords),
        cc: uniqueAddresses(resolved.ccRecords),
    };
    if (!recipients.to.length) return { skipped: true, reason: 'No recipients' };

    const emailModel = await getRequestEmailModel(requestId, resolved.dear);
    try {
        await createWorkflowNotifications({
            event,
            requestId,
            toRecords: resolved.toRecords,
            ccRecords: resolved.ccRecords,
            actorEmail,
            actorName,
            actorCode: employeeCode(auditActorCode) ?? approvalAuditEmployeeCode(user?.profile),
            emailModel,
        });
    } catch (error) {
        logger.error(`Workflow in-app notification failed for request ${requestId}: ${error.message}`);
    }
    const subject =  event === 'submit' || event === 'approve'
        ? buildApprovalSubject(emailModel)
        : event === 'final'
            ? `${eventConfig.subject} ${emailModel.companyName} (${emailModel.salesGroup})`
            : event === 'completed'
                ? buildCompletedSubject(emailModel)
                : event === 'cancel' || event === 'final-cancel'
                    ? buildCancelledSubject(emailModel)
                    : event === 'reject'
                        ? buildRejectedSubject(emailModel)
                    : event === 'backward'
                        ? buildBackwardSubject(emailModel)
            : eventConfig.subject;
    if (!approvalApprovers.length) {
        return sendRequestWorkflowEmail({ environment: normalizedEnvironment, template: eventConfig.template, subject, emailModel, recipients, actorEmail, transporter, requestId, user, auditActorCode });
    }

    return Promise.all(approvalApprovers.map(async (approver) => {
        const approverModel = await getRequestEmailModel(requestId, approver.APPROVER_NAME || resolved.dear);
        approverModel.approvalActions = approvalActionsFor(requestId, [approver]);
        return sendRequestWorkflowEmail({
            environment: normalizedEnvironment,
            template: eventConfig.template,
            subject: buildApprovalSubject(approverModel),
            emailModel: approverModel,
            recipients: { to: [String(approver.APPROVER_EMAIL || '').trim()], cc: [] },
            actorEmail,
            transporter,
            requestId,
            user,
            auditActorCode,
            reminderContext: { approvalId: approver.ID },
        });
    }));
}

async function notifyBestEffort(options) {
    try {
        return await sendRequestWorkflowNotification(options);
    } catch (error) {
        logger.error(`Workflow email failed: ${error.message}`, {
            requestId: options.requestId,
            event: options.event,
            stack: error.stack,
        });
        return { failed: true };
    }
}

module.exports = {
    pendingApprovers,
    isParallelApprovalIncomplete,
    bdsReviewApprovers,
    resolveRecipients,
    buildApprovalSubject,
    buildCompletedSubject,
    buildCancelledSubject,
    buildRejectedSubject,
    sendRequestWorkflowNotification,
    notifyBestEffort,
    approvalActionsFor,
};