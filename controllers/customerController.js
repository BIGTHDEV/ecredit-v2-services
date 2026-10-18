const logger = require('../config/logger');
const customerService = require('../services/customerService');
const customerLogService = require('../services/customerLogService');
const companyInfoSuggestionService = require('../services/powerPlatformCompanyInfoService');
const { effectiveEmployeeCode } = require('../helpers/userIdentity');
const { companyInfoUserName, companyInfoUserEmail } = require('../helpers/companyInfoUser');

async function listCustomers(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const data = await customerService.listCustomers(req.query);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });

    logger.debug('Customers returned', {
      correlationId,
      route: { method: req.method, path: req.path },
      payload: { page: data.pagination.page, pageSize: data.pagination.pageSize, totalItems: data.pagination.totalItems },
    });
  } catch (error) {
    logger.error(`Error in listCustomers: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function getCustomer(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const customer = await customerService.getCustomerById(req.params.id);

    if (!customer) {
      const error = new Error(`Customer ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data: customer, correlationId });

    logger.debug('Customer returned', {
      correlationId,
      route: { method: req.method, path: req.path },
      payload: { id: customer.id },
    });
  } catch (error) {
    logger.error(`Error in getCustomer: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

async function listEnabledSizes(req, res, next) {
  try {
    const data = await customerService.listEnabledSizes();
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) {
    next(error);
  }
}

async function searchSoldToCustomers(req, res, next) {
  try {
    const data = await customerService.searchSoldToCustomers(req.query.search, req.query.salesGroup);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) {
    next(error);
  }
}

async function customerTaxNoExists(req, res, next) {
  try {
    const data = await customerService.customerTaxNoExists(req.query.taxNo);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId: res.locals.correlationId || 'N/A' });
  } catch (error) {
    next(error);
  }
}

async function recordCompanyInfoLookupBestEffort(entry, correlationId) {
  if (!entry.customerId) return;
  try {
    await customerLogService.recordCompanyInfoLookup(entry);
  } catch (error) {
    logger.error(`Failed to record company information lookup customer log: ${error.message}`, {
      correlationId,
      payload: { customerId: entry.customerId },
      stack: error.stack,
    });
  }
}

async function suggestCustomerCompanyInfo(req, res, next) {
  const correlationId = res.locals.correlationId || 'N/A';
  let lookupLog = null;
  try {
    const taxId = req.body?.taxId;
    if (typeof taxId !== 'string' || !/^\d{13}$/.test(taxId)) {
      const error = new Error('Tax ID must contain exactly 13 digits.');
      error.statusCode = 400;
      error.code = 'INVALID_TAX_ID';
      throw error;
    }

    const customerId = req.body?.customerId;
    if (customerId !== undefined && customerId !== null
      && (typeof customerId !== 'string' || !customerId.trim() || customerId.length > 128)) {
      const error = new Error('Customer ID is invalid.');
      error.statusCode = 400;
      error.code = 'INVALID_INPUT';
      throw error;
    }

    const profile = req.user?.profile;
    const employeeCode = effectiveEmployeeCode(profile);
    if (!Number.isInteger(employeeCode)) {
      const error = new Error('Authenticated user profile is missing a numeric employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    if (customerId) {
      await customerLogService.assertActiveCustomer(customerId);
      lookupLog = { customerId, taxNo: taxId, actorId: employeeCode };
    }

    const data = await companyInfoSuggestionService.suggestCompanyInfo(taxId, {
      userEmail: companyInfoUserEmail(req),
      userName: companyInfoUserName(profile),
      onRequestPayload: (payload) => {
        if (lookupLog) lookupLog.outboundPayload = payload;
        res.locals.outboundRequests = [{
          system: 'Power Platform',
          method: 'POST',
          body: payload,
        }];
      },
    });
    if (lookupLog) await recordCompanyInfoLookupBestEffort({ ...lookupLog, result: data }, correlationId);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({ success: true, data, correlationId });

    logger.info('Customer company information suggestions generated', {
      correlationId,
      route: { method: req.method, path: req.path },
      payload: { customerId: customerId || null, sourceCount: data.sources.length },
    });
  } catch (error) {
    if (lookupLog) await recordCompanyInfoLookupBestEffort({ ...lookupLog, error }, correlationId);
    logger.error(`Error in suggestCustomerCompanyInfo: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      errorCode: error.code,
      stack: error.stack,
    });
    next(error);
  }
}

async function createCustomer(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!updatedBy) {
      const error = new Error('Authenticated user profile is missing an employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const customer = await customerService.createCustomer(req.body, updatedBy);
    res.status(201).json({ success: true, data: customer, correlationId });
  } catch (error) {
    next(error);
  }
}

async function updateCustomer(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!updatedBy) {
      const error = new Error('Authenticated user profile is missing an employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const customer = await customerService.updateCustomer(req.params.id, req.body, updatedBy);
    if (!customer) {
      const error = new Error(`Customer ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    res.status(200).json({ success: true, data: customer, correlationId });
  } catch (error) {
    next(error);
  }
}

async function deleteCustomer(req, res, next) {
  try {
    const correlationId = res.locals.correlationId || 'N/A';
    const updatedBy = effectiveEmployeeCode(req.user?.profile);
    if (!updatedBy) {
      const error = new Error('Authenticated user profile is missing an employee code.');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    const deleted = await customerService.softDeleteCustomer(req.params.id, req.body?.DESCRIPTION, updatedBy);

    if (!deleted) {
      const error = new Error(`Customer ${req.params.id} was not found.`);
      error.statusCode = 404;
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    res.status(200).json({ success: true, data: { id: req.params.id }, correlationId });

    logger.debug('Customer soft deleted', {
      correlationId,
      route: { method: req.method, path: req.path },
      payload: { id: req.params.id, updatedBy },
    });
  } catch (error) {
    logger.error(`Error in deleteCustomer: ${error.message}`, {
      correlationId: res.locals.correlationId,
      route: { method: req.method, path: req.path },
      stack: error.stack,
    });
    next(error);
  }
}

module.exports = {
  listCustomers,
  listEnabledSizes,
  searchSoldToCustomers,
  customerTaxNoExists,
  suggestCustomerCompanyInfo,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
