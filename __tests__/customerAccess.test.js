const { describe, expect, it } = require('@jest/globals');
const customerAccessMiddleware = require('../middlewares/customerAccess');

describe('customerAccessMiddleware', () => {
  it.each([
    ['System Admin', 'd854d840-d18c-4a7d-87c1-a9186f8664e5'],
    ['Super Admin', 'fd08992c-08cc-4c39-8f0d-dfcc0cb90663'],
  ])('allows the %s role', (role, roleId) => {
    const calls = [];
    const next = (...args) => calls.push(args);

    customerAccessMiddleware({ user: { profile: { ROLE: role, ROLE_ID: roleId } } }, {}, next);

    expect(calls).toEqual([[]]);
  });

  it('rejects users without either allowed role', () => {
    const calls = [];
    const next = (...args) => calls.push(args);

    customerAccessMiddleware({
      user: { profile: { ROLE: 'Credit Analyst', ROLE_ID: 'b01a858e-bded-4689-9681-5f8de7ee4066' } },
    }, {}, next);

    const [error] = calls[0];
    expect(error).toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only the System Admin or Super Admin role can access Customer Extensions.',
    });
  });
});
