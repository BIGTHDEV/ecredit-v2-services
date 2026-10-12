const { describe, expect, it } = require('@jest/globals');
const { isAdminRole, isSystemAdminRole } = require('../helpers/roleAuthorization');

describe('isAdminRole', () => {
  it('recognizes the System Admin role by name or ID', () => {
    expect(isAdminRole('System Admin', null)).toBe(true);
    expect(isAdminRole(null, 'd854d840-d18c-4a7d-87c1-a9186f8664e5')).toBe(true);
  });

  describe('isSystemAdminRole', () => {
    it('recognizes only the System Admin role by name or ID', () => {
      expect(isSystemAdminRole('System Admin', null)).toBe(true);
      expect(isSystemAdminRole(null, 'd854d840-d18c-4a7d-87c1-a9186f8664e5')).toBe(true);
      expect(isSystemAdminRole('Super Admin', null)).toBe(false);
      expect(isSystemAdminRole(null, 'fd08992c-08cc-4c39-8f0d-dfcc0cb90663')).toBe(false);
      expect(isSystemAdminRole('Credit Analyst', null)).toBe(false);
    });
  });

  it('recognizes the Super Admin role by name or ID', () => {
    expect(isAdminRole('Super Admin', null)).toBe(true);
    expect(isAdminRole(null, 'fd08992c-08cc-4c39-8f0d-dfcc0cb90663')).toBe(true);
  });

  it('does not grant admin access to other roles', () => {
    expect(isAdminRole('Credit Analyst', 'b01a858e-bded-4689-9681-5f8de7ee4066')).toBe(false);
    expect(isAdminRole(null, null)).toBe(false);
  });
});
