const logger = require('../../config/logger');
const customerService = require('../../services/customerService');
const { effectiveEmployeeCode } = require('../../helpers/userIdentity');

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
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
