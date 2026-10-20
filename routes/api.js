const express = require('express');
const homeRoute = require('./homeRoute');
const authRoute = require('./authRoute');
const sessionRoute = require('./sessionRoute');
const healthRoute = require('./healthRoute');
const docsRoute = require('./docsRoute');
const requestRoute = require('./requestRoute');
const customerRoute = require('./customerRoute');
const permissionRoute = require('./permissionRoute');
const userRoute = require('./userRoute');
const approverRoute = require('./approverRoute');
const emailApprovalRoute = require('./emailApprovalRoute');
const notificationRoute = require('./notificationRoute');
const emailReminderRoute = require('./emailReminderRoute');
const maintenanceRoute = require('./maintenanceRoute');
const maintenanceGate = require('../middlewares/maintenance');

/**
 * Shared API Route Aggregator
 * Mounts all shared API subroutes
 * - All routes mounted with /api prefix by parent routes/index.js
 * - Public routes: home, health
 * - Authenticated routes: auth, session
 * - Documentation: docs
 */

const router = express.Router();
router.use(maintenanceGate);
router.use('/maintenance', maintenanceRoute);

// Mount subroutes
router.use('/home', homeRoute);
router.use('/auth', authRoute);
router.use('/session', sessionRoute);
router.use('/requests', requestRoute);
router.use('/customers', customerRoute);
router.use('/permissions', permissionRoute);
router.use('/users', userRoute);
router.use('/approvers', approverRoute);
router.use('/health', healthRoute);
router.use('/docs', docsRoute);
router.use('/email-approval', emailApprovalRoute);
router.use('/notifications', notificationRoute);
router.use('/email-reminders', emailReminderRoute);

module.exports = router;
