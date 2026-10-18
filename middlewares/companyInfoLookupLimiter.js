const rateLimit = require('express-rate-limit');

// Shared by every company-information lookup endpoint so users get one combined search quota.
const companyInfoLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many company information searches. Please try again later.' },
  },
});

module.exports = companyInfoLookupLimiter;
