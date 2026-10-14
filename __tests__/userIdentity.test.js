/* eslint-env jest */

const {
  effectiveEmployeeCode,
  mainEmployeeCode,
  approvalAuditEmployeeCode,
} = require('../helpers/userIdentity');

describe('View As user identity', () => {
  const profile = {
    CODE: '20261631',
    EFFECTIVE_CODE: '20261631',
    LOGGED_IN_CODE: '20221459',
    MAIN_CODE: '20221459',
    ROLE: 'Credit Analyst',
    LOGGED_IN_ROLE: 'System Admin',
  };

  it('resolves main and effective employee codes separately', () => {
    expect(effectiveEmployeeCode(profile)).toBe(20261631);
    expect(mainEmployeeCode(profile)).toBe(20221459);
  });

  it('uses Main User only for Approval/Final audit when Main User is System Admin', () => {
    expect(approvalAuditEmployeeCode(profile)).toBe(20221459);
    expect(approvalAuditEmployeeCode({
      ...profile,
      LOGGED_IN_ROLE: 'Super User',
      LOGGED_IN_ROLE_ID: 'fd08992c-08cc-4c39-8f0d-dfcc0cb90663',
    })).toBe(20261631);
    expect(approvalAuditEmployeeCode({
      ...profile,
      LOGGED_IN_ROLE: 'Credit Analyst',
    })).toBe(20261631);
  });

  it('returns null for a missing or invalid employee code', () => {
    expect(effectiveEmployeeCode({ CODE: '' })).toBeNull();
    expect(effectiveEmployeeCode({ CODE: ' ' })).toBeNull();
    expect(mainEmployeeCode({ LOGGED_IN_CODE: 'not-numeric' })).toBeNull();
  });
});
