# Security Guide

## Overview

This guide documents the security configuration and best practices for the e-Credit Express API.

## Authentication & Authorization

### Microsoft Entra ID (Azure AD)

The API uses **single-tenant Microsoft Entra ID** authentication for:
- Centralized identity management
- Compliance with organizational policies
- Audit trail of API access
- Secure token handling with MSAL

### Tenant Configuration

**Organization**: Your Organization (e-Credit)
**Tenant ID**: `c5e7210b-25bc-45c8-ad35-0ac4c50ca2f4`
**Authority**: `https://login.microsoftonline.com/c5e7210b-25bc-45c8-ad35-0ac4c50ca2f4`

### Application Registration

**Application Name**: e-Credit Express API
**Client ID**: `94ea24c7-b390-4ef8-9f97-c9b4bebe3298`
**Scope**: `api://94ea24c7-b390-4ef8-9f97-c9b4bebe3298/access_as_user`

### Token Validation

Every API request must include a valid JWT access token in the Authorization header:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjE...
```

The API validates:
1. **Signature** - Token signed with MSAL's private key (RS256)
2. **Expiration** - `exp` claim not in past
3. **Audience** - `aud` = `94ea24c7-b390-4ef8-9f97-c9b4bebe3298`
4. **Issuer** - `iss` = `https://login.microsoftonline.com/c5e7210b-25bc-45c8-ad35-0ac4c50ca2f4/v2.0`
5. **Tenant** - `tid` = `c5e7210b-25bc-45c8-ad35-0ac4c50ca2f4`
6. **Scope** - `scp` contains `access_as_user`

### Common Token Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `AUTH_MISSING_TOKEN` | No Authorization header | Add `Authorization: Bearer <token>` header |
| `AUTH_INVALID_TOKEN` | Token malformed or invalid | Verify token is valid JWT |
| `AUTH_TOKEN_EXPIRED` | Token expiration time passed | Refresh token using MSAL |
| `AUTH_INVALID_AUDIENCE` | Token intended for different API | Ensure token scope is `api://.../access_as_user` |
| `AUTH_INVALID_ISSUER` | Token from untrusted issuer | Verify tenant ID matches configuration |
| `AUTH_INVALID_TENANT` | Token from different tenant | Contact Azure AD admin if need multi-tenant access |
| `AUTH_INSUFFICIENT_SCOPE` | Missing required delegated scope | Request token with correct scope |

### Token Acquisition (Frontend)

Use MSAL.js to acquire tokens:

```typescript
const config = {
  auth: {
    clientId: '94ea24c7-b390-4ef8-9f97-c9b4bebe3298',
    authority: 'https://login.microsoftonline.com/c5e7210b-25bc-45c8-ad35-0ac4c50ca2f4',
    redirectUri: 'https://app.example.com',
  },
};

const request = {
  scopes: ['api://94ea24c7-b390-4ef8-9f97-c9b4bebe3298/access_as_user'],
};

const response = await msalInstance.acquireTokenSilent(request);
const accessToken = response.accessToken;
```

### Multi-Tenant Considerations

Currently configured for **single-tenant only** (your organization).

To support additional tenants:
1. Change authority to `/common` endpoint
2. Implement tenant allowlisting
3. Validate `tid` claim against allowed tenants
4. Update issuer validation to support multiple issuers

**NOT RECOMMENDED** for production without explicit business requirement.

## Certificate Security

### HTTPS Configuration

The API runs on **HTTPS port 3035** with certificates from:
```
\\Cloudapp02\d\Certificates\
  - private.key
  - bigth.crt
  - CA_root.crt
```

### Certificate Permissions

Only the service account should have read access:

```powershell
# Verify certificate permissions
Get-Acl "\\Cloudapp02\d\Certificates\private.key" | Format-List

# Grant permissions (if needed)
$acl = Get-Acl "\\Cloudapp02\d\Certificates"
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  "DOMAIN\ServiceAccount", "Read", "Allow"
)
$acl.SetAccessRule($rule)
Set-Acl -Path "\\Cloudapp02\d\Certificates" -AclObject $acl
```

### Certificate Best Practices

1. **Never commit certificate paths to Git** - Use environment variables
2. **Never log certificate contents** - The logger redacts them
3. **Never embed certificates in code** - Always load from UNC paths
4. **Rotate certificates annually** - Keep expiration dates tracked
5. **Use strong encryption** - Certificates should use 2048-bit RSA or stronger

### Certificate Rotation

When certificates expire or need rotation:

1. Upload new certificates to `\\Cloudapp02\d\Certificates\`
2. Restart the Node.js service:
   ```powershell
   nssm restart node-app-ecredit
   ```
3. The app will load new certificates on startup
4. Verify via curl:
   ```bash
   curl -kv https://localhost:3035/dev/api/home
   ```

## Database Security

### Connection Security

```
DB_SERVER=clouddb01
DB_USER=<service_account>
DB_PASSWORD=<strong_password>
DB_ENCRYPT=true        # Required for qas/prd
DB_TRUST_SERVER_CERTIFICATE=false  # Verify certificate chain
```

### Service Account Permissions

The database service account should have **minimal necessary permissions**:

```sql
-- Create login from Windows domain
CREATE LOGIN [DOMAIN\ServiceAccount] FROM WINDOWS;

-- Create user in eCredit database
USE eCredit;
CREATE USER [DOMAIN\ServiceAccount] FOR LOGIN [DOMAIN\ServiceAccount];

-- Grant minimal permissions (do NOT use sysadmin role!)
ALTER ROLE db_datareader ADD MEMBER [DOMAIN\ServiceAccount];
ALTER ROLE db_datawriter ADD MEMBER [DOMAIN\ServiceAccount];
-- DO NOT grant ddl_admin or alter roles unless absolutely necessary
```

### SQL Injection Prevention

The app uses Sequelize ORM which prevents SQL injection via:
1. Parameterized queries (not concatenated SQL)
2. Input validation via models
3. Escaping of user input

**Never use raw SQL with user input:**
```javascript
// UNSAFE - DO NOT USE
sequelize.query(`SELECT * FROM users WHERE id = ${userId}`);

// SAFE - Use parameterized queries
sequelize.query('SELECT * FROM users WHERE id = ?', {
  replacements: [userId],
});
```

### Sensitive Data Protection

**Never log to database:**
- Access tokens
- User passwords
- API keys
- Personally identifiable information (PII)

All authentication logs are application logs only, not database records.

## Logging Security

### Redaction

The logger automatically redacts sensitive fields:

**Redacted headers:**
- `Authorization`
- `Proxy-Authorization`
- `Cookie`
- `Set-Cookie`

**Redacted fields:**
- `access_token`
- `id_token`
- `refresh_token`
- `client_secret`
- `db_password`
- `password`
- `secret`

Example - Authorization header is logged as:
```
Authorization: ***REDACTED***
```

### Log Storage

Logs are stored in:
```
D:\web_is\Services\iisnode\ecredit-services\logs\
```

**Permissions:** Only service account and administrators should have access

**Retention:** 30 days (configured in `config/logger.js`)

### Log Access

**Development environment:** Full logs with stack traces
**QAS/Production:** No console output, file logs only (no stack traces by default)

## CORS Security

### Allowed Origins

Configure additional allowed origins via `CORS_ALLOWED_ORIGINS`. The origin
(scheme and host, without a path) from `FRONTEND_BASE_URL` is also allowed
automatically, so the deployed frontend and CORS configuration stay aligned.
For QAS, set `FRONTEND_BASE_URL` to `https://ecredit-qas.bigth.com`.

```
CORS_ALLOWED_ORIGINS=http://localhost:4200,https://localhost:4200
```

**DO NOT use wildcard (`*`)** for authenticated endpoints

### Preflight Requests

CORS preflight requests are handled automatically:
- OPTIONS requests return 200 with CORS headers
- Only configured origins are allowed
- Credentials are allowed if origin is whitelisted

## Rate Limiting

### Current Configuration

```
Limit: 100 requests per IP
Window: 15 minutes
Applied to: All routes
```

To adjust:
```javascript
// app.js
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // Requests per window
});
```

### Bypass Rate Limiting

Rate limiting can be disabled for specific routes (e.g., health checks):

```javascript
// Skip rate limiting for health endpoints
app.get('/health/live', limiter.skip(), healthController.getHealthStatus);
```

## API Response Security

### Error Message Sanitization

**Development:**
- Full error details and stack traces
- Useful for debugging
- Never exposed to production

**QAS/Production:**
- Generic error messages
- No stack traces
- No internal details leaked

Example error response:
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An internal server error occurred."
  },
  "correlationId": "uuid"
}
```

**NOT returned to client:**
- SQL error messages
- Database server names
- File paths
- Stack traces
- Configuration values
- API key details

### Status Codes

API returns appropriate HTTP status codes:
- `200` - Success
- `400` - Validation error (client input invalid)
- `401` - Authentication error (missing/invalid token)
- `403` - Authorization error (user lacks permission)
- `404` - Resource not found
- `409` - Conflict (resource already exists)
- `429` - Rate limited (too many requests)
- `500` - Internal server error (server error)
- `503` - Service unavailable (database down)

## Credential Management

### Environment Variables

**DO NOT commit real .env files to Git:**
```
.env.dev    → .gitignore
.env.qas    → .gitignore
.env.prd    → .gitignore
```

Use `.env.example` as template with placeholders only:
```
DB_PASSWORD=<DATABASE_PASSWORD>
MSAL_TENANT_ID=<DIRECTORY_TENANT_ID>
```

### Rotation Schedule

| Credential | Frequency | Procedure |
|------------|-----------|-----------|
| Database password | Annually or per policy | 1) Create new password in SQL Server 2) Update .env file 3) Restart service |
| JWT secrets | Annually or if compromised | Update .env file and restart service |
| Certificates | Per certificate expiration (typically 1-2 years) | 1) Upload new certs to network share 2) Restart service |
| Access tokens | Per configuration (24h default) | Automatic via MSAL token refresh |

### Compromised Credential Response

If credentials are compromised:

1. **Database password**: Immediately create new password, update .env, restart service
2. **API certificates**: Upload new certs, restart service, notify clients
3. **Azure AD tokens**: MSAL handles automatically (tokens auto-expire)
4. **Git history**: Review git logs for credential commits
   ```bash
   git log -p | grep -i password
   ```

## Compliance & Audit

### Audit Trail

All API requests are logged with:
- Timestamp
- Correlation ID
- User identity (oid, tid)
- HTTP method and endpoint
- Status code
- Response time
- Any errors

Use correlation IDs to trace requests across systems for compliance audits.

### Data Minimization

The API requests and logs:

**Requested:**
- User OID and Tenant ID (for identity)
- Request method and path
- Status code and timing
- Error codes (sanitized)

**NOT Requested/Logged:**
- User email (available but not in basic logging)
- Request/response body details
- Personal information
- Passwords or credentials

### Secure Logging Practices

- ✓ All logs use UTC timestamps (ISO 8601)
- ✓ No console output in production
- ✓ File-based logs with daily rotation
- ✓ 30-day retention (configurable)
- ✓ Sensitive data redaction
- ✓ Correlation IDs for traceability

## Monitoring & Alerts

### Health Checks

Regular health checks ensure API availability:

```bash
# Liveness probe (is app running?)
curl -k https://localhost:3035/dev/api/health/live

# Readiness probe (can it handle requests?)
curl -k https://localhost:3035/dev/api/health/ready
```

### Performance Monitoring

Monitor via Windows Performance Monitor or application monitoring tools:
- Request count per minute
- Average response time
- Error rate
- Database connection pool usage
- Memory usage

### Security Alerts

Monitor logs for:
- Repeated 401 (authentication failures) - possible attack
- Repeated 403 (authorization failures) - possible access violation
- Rate limiting (429) - possible DoS attack
- 5xx errors - application or database issues

Set up log monitoring with:
```powershell
# Windows Event Log monitoring
Get-EventLog Application -Source Node | Where-Object { $_.EntryType -eq 'Error' }

# Application log analysis
Select-String "AUTH_INVALID" logs/ecredit-error-*.txt | Measure-Object
```

## Best Practices Summary

### Do's ✓
- ✓ Validate all tokens before using
- ✓ Redact sensitive data in logs
- ✓ Use HTTPS for all communication
- ✓ Rotate credentials regularly
- ✓ Use strong unique passwords
- ✓ Restrict permissions to minimum needed
- ✓ Monitor logs for security events
- ✓ Keep dependencies updated
- ✓ Test security before release

### Don'ts ✗
- ✗ Don't hardcode credentials in code
- ✗ Don't log access tokens or passwords
- ✗ Don't use weak or generic passwords
- ✗ Don't use `*` for CORS origins
- ✗ Don't skip certificate validation
- ✗ Don't expose stack traces to clients
- ✗ Don't commit .env files to Git
- ✗ Don't allow user input in SQL queries
- ✗ Don't disable authentication for convenience

## Security Checklist

Before deploying to production:

- [ ] All .env files are created and NOT in Git
- [ ] Database password meets complexity requirements
- [ ] Service account has minimal necessary permissions
- [ ] HTTPS certificates are valid and not expired
- [ ] Certificate permissions restrict access to service account only
- [ ] CORS origins are explicitly configured (no wildcard)
- [ ] Rate limiting is enabled
- [ ] Logging is configured and logs are stored securely
- [ ] Authentication middleware is active on all protected routes
- [ ] Error handling redacts sensitive information
- [ ] Database credentials are in environment variables only
- [ ] Token validation includes all required claims
- [ ] Health check endpoints do not expose sensitive data
- [ ] Logs are monitored for security events
- [ ] Backup/recovery procedures tested
- [ ] Security team has reviewed configuration
