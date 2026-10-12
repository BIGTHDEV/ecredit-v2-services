const errorCodes = require('../helpers/errorCodes');
const { isAdminRole } = require('../helpers/roleAuthorization');

function customerAccessMiddleware(req, res, next) {
  const profile = req.user?.profile;
  if (isAdminRole(profile?.ROLE, profile?.ROLE_ID)) {
    return next();
  }

  const error = new Error('Only the System Admin or Super Admin role can access Customer Extensions.');
  error.statusCode = 403;
  error.code = errorCodes.FORBIDDEN;
  return next(error);
}

module.exports = customerAccessMiddleware;
