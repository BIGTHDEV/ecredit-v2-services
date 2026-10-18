function companyInfoUserName(profile) {
  const initials = String(profile?.LOGGED_IN_INITIALS || profile?.INITIALS || '').trim();
  const fullName = String(profile?.LOGGED_IN_FULL_NAME || profile?.FULL_NAME || '')
    .trim()
    .replace(/^(?:mr|mrs|ms|miss|dr|prof)\.?\s+/i, '');
  if (initials && fullName) return `${initials} (${fullName})`;

  return String(profile?.LOGGED_IN_USERNAME
    || (!profile?.IS_VIEWING_AS ? profile?.USERNAME : '')
    || '').trim();
}

function companyInfoUserEmail(req) {
  const profile = req.user?.profile;
  return String(profile?.LOGGED_IN_EMAIL || req.user?.email || profile?.EMAIL || '').trim();
}

module.exports = { companyInfoUserName, companyInfoUserEmail };
