# e-Credit Backend API

Express.js backend service for e-Credit application with:
- Microsoft Entra ID single-tenant authentication
- SQL Server database integration via Sequelize ORM
- Multi-environment support (dev, qas, prd)
- HTTPS with certificate-based security
- Comprehensive logging with daily rotation
- Swagger/OpenAPI 3.x documentation
- Shared controllers and routes with environment-specific API prefixes

## Quick Start

### Final Review condition snapshot

When the last pending approval is approved, the transition to Final copies all
six Additional Conditions fields from that approval into the request's approved
snapshot, including false flags and zero amounts. Final Review reads this
snapshot as its initial decision values. Subsequent Final Review saves and
confirmation update the snapshot without modifying earlier approval history.
This applies to new transitions to Final; existing snapshots are not backfilled.

### Administration email logs

`GET /requests/email-logs` lists email logs across active requests for System Admin
and Super User roles only. It accepts `page`, `pageSize` (up to 100), `sort`, `dir`
and column filters `NO`, `CRM_NO`, `SOLD_TO`, `CUSTOMER_TAX_NO`, `name`,
`logTypeId` (Success/Sent, Error/Failed, Pending/Warning) and `createdDate`, `actor`.
Filters are limited to 100 characters. Responses are non-cacheable and contain
request identity plus email summaries, not stored send parameters.
Automatic reminders without an employee updater display **System (Auto Reminder)**
in Updated By, including in request-details email logs. Actor filtering and sorting
use this label too. Manual resends retain the employee actor.
Payload inspection and resending reuse `GET /requests/:requestId/emails/:emailId`
and `POST /requests/:requestId/emails/resend` with `{ "emailIds": [...] }`.
No database migration is required for this page.

### Prerequisites
- Node.js 22.12.0
- SQL Server (clouddb01\dev, clouddb01\qas, or clouddb01\prd)
- HTTPS certificates on UNC paths (\\Cloudapp02\d\Certificates\)
- Service account with read permissions to certificate share

### Installation

```bash
# Install dependencies
npm install

# Verify ESLint configuration
npm run lint
```

### Development

```bash
# Start dev environment (NODE_ENV=dev)
npm run start:dev

# Start with auto-reload (requires nodemon)
npm run dev
```

The API will be available at: `https://localhost:3035/dev/api`

Swagger UI: `https://localhost:3035/dev/api/docs`

### Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch
```

### Linting

```bash
# Check code quality
npm run lint

# Fix linting issues automatically
npm run lint:fix
```

## Environment Configuration

Each environment uses a dedicated `.env` file:

- `.env.dev` - Development configuration
- `.env.qas` - QAS/Staging configuration
- `.env.prd` - Production configuration

`npm run start:<env>` sets `NODE_ENV` and loads the matching file through
`config/env.js`. Shared controllers and routes do not select database connections.
`config/database.js` creates one Sequelize connection per process from the active
`DB_SERVER`, `DB_INSTANCE_NAME`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, TLS,
and pool settings. Existing process environment variables take precedence over the
file, so deployment services must not inherit database settings from another environment.

**Do not commit .env files to Git** - they are in `.gitignore`

Copy `.env.example` and update with actual values:

```bash
NODE_ENV=dev
PORT=3035
DB_SERVER=clouddb01
DB_INSTANCE_NAME=dev
DB_USER=sa
DB_PASSWORD=<actual_password>
# ... other required variables
```

### AI-assisted customer information suggestions

The Customers tab can use a 13-digit Tax ID to suggest registered date, registered
capital, external customer type, official signatories, and major shareholders. The
search is server-side, available only to an authenticated participant or System Admin
on a draft request, and returns suggestions with source links for review. Existing
form values are not selected for replacement by default; applying registered capital
uses the normal customer-field update so the customer Size is recalculated. The user
must still save customer information to persist any applied suggestions.

This feature sends a prompt containing the Tax ID to a Power Platform flow. Configure
the flow URL in the deployment secret store or environment-specific settings:

```bash
POWERPLATFORM_URL=<HTTPS URL of the Power Automate flow trigger>
```

The URL can contain a signed trigger token, so treat it as a secret and never commit
it or write it to logs. The backend sends a request with this shape:

```json
{
  "Prompt": "<generated prompt>",
  "userEmail": "<authenticated user's email>",
  "userName": "<authenticated user's username>",
  "Application": "eCredit",
  "Module": "Main",
  "Remark": "<ENV>|Company information lookup by Tax ID"
}
```

The flow must return either a JSON object or a JSON string with this shape. If the
Power Platform response wraps the AI output in a `text` property, that property may
contain the JSON string:

```json
{
  "fields": {
    "registeredDate": { "value": "YYYY-MM-DD or null", "evidence": "text or null" },
    "registeredCapitalAmount": { "value": "digits only or null", "evidence": "text or null" },
    "customerTypeExternal": { "value": "text or null", "evidence": "text or null" },
    "officialSignatory": { "value": "text or null", "evidence": "text or null" },
    "majorShareholders": { "value": "text or null", "evidence": "text or null" }
  },
  "sources": [{ "title": "Source name", "url": "https://..." }]
}
```

Configure the Power Automate HTTP trigger and response action to use this contract.
The `sources` array must contain at least one source actually opened during lookup,
with a title and a real HTTPS URL. Do not fabricate URLs. If no company fields can be
verified, return null values for those fields but still include the sources that were
checked. The backend rejects responses without a verifiable HTTPS source link.
The flow must have an approved way to look up public company records; sending a prompt
to an AI model alone doesn't provide web search.
Ensure the organization's Power Platform licensing, connector permissions, and data
policies cover the flow's AI and search actions. The flow URL is read from
`POWERPLATFORM_URL` in the active environment configuration. Never put it in source
control or logs.

### Registered capital amount

Before deploying the capital-based customer Size calculation, apply
`database/migrations/20260831_expand_registered_capital_amount.sql` through the SQL Server
deployment process. It changes `REQUESTS.CUSTOMER_REGISTERED_CAPITAL_AMOUNT` to
`DECIMAL(38, 0)` so the application can store whole-number capital values without the former
18-digit limit.

### SharePoint attachment storage

Attachments use the existing file share by default. Before enabling SharePoint, apply
`database/migrations/20260811_add_attachment_storage_metadata.sql` through the SQL Server
deployment process. The script is idempotent and marks existing rows as `FILE_SHARE`.

Set these values in each environment only after the migration has been applied:

```bash
ATTACHMENT_STORAGE_PROVIDER=SHAREPOINT
GRAPH_CLIENT_ID=<Entra application client ID>
GRAPH_CLIENT_SECRET=<application secret from the deployment secret store>
GRAPH_DRIVE_ID=<SharePoint document library drive ID>
GRAPH_ROOT_FOLDER_ID=<eCredit root folder item ID>
```

The Entra application must use application permissions restricted to the selected SharePoint
site/library. New files are stored through Microsoft Graph; the download URL remains an
authenticated eCredit API endpoint. Keep the legacy file-share configuration until existing
attachments have been migrated.

## Email Service

The reusable email module is available from `services/emailService.js` and renders Handlebars
templates from `templates/`. The first named email wrapper is
`emails/requestCompletedEmail.js`. Action endpoints are not wired to email yet.

Email configuration is read from the active `.env.{NODE_ENV}` file:

```text
EMAIL_SMTP_HOST=smtp.office365.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=<smtp username>
EMAIL_SMTP_PASSWORD=<smtp password>
EMAIL_FROM=<sender address>
EMAIL_BCC=<audit address or comma-separated addresses>
```

Example:

```javascript
const { sendRequestCompletedEmail } = require('./emails/requestCompletedEmail');

await sendRequestCompletedEmail({
  environment: 'dev',
  subject: 'Request completed',
  actorEmail: req.user.email,
  emailModel: {
    dear: 'Approver',
    companyName: 'Acme Company',
    customerType: 'External',
  },
});
```

The template and service fill omitted values with `-`. The supported model keys are
`dear`, `requestType`, `companyName`, `soldToNo`, `salesGroup`, `businessType`,
`customerType`, `companyRegisterDate`, `registeredCapital`, `companySize`,
`creditRatingScore`, `profitability`, `growth`, `liquidity`, `leverage`, `amountBank`,
`amountDeposit`, `opinion`, `creditTermExisting`, `creditTermRequested`,
`creditTermProposed`, `creditLimitExisting`, `creditLimitRequested`,
`creditLimitProposed`, and `creditDetailsMovements` (the ordered Movement history
entries, including parallel approval step numbers, approver details, comments,
credit values, conditions, and adjustment details), `creditDetailsSummary`,
`suggestedCreditDetails`, `currentStep`, and `lastActionedStep` (the approval
summary, the latest current-cycle credit suggestion, the current pending step,
and the previous actioned step shown for decision support).

Recipient policy:

- DEV/QAS send `TO` only to the logged-in tester (`req.user.profile.LOGGED_IN_EMAIL`, or
  `req.user.email`), never the View As user. `CC` is empty.
- DEV/QAS reject delivery if no tester email is available; `EMAIL_BCC` is still added as `BCC`.
- PRD accepts `recipients: { to: string[], cc: string[] }` from the caller.
- All environments add `EMAIL_BCC` as `BCC`; resend and reminder deliveries use the current configured value.
- `request-draft` always greets `Credit Team`. TO is every enabled `USER_ROLES`
  member with role ID `fd08992c-08cc-4c39-8f0d-dfcc0cb90663`, joined to
  `S_EMPLOYEE1` by employee code; CC is the enabled request's `REQUESTED_BY`
  employee. These recipients are queried again for each send, resend, and reminder.
  In DEV/QAS, the "Show for testing only." footer displays these intended TO/CC
  recipients while delivery remains restricted to the tester. Missing team or
  requester email recipients cause an explicit error rather than fallback delivery.
- Resending uses the current runtime environment and current logged-in tester, not
  the environment or tester stored in an old email log. PRD retains logged recipients
  except for `request-draft`, which uses the current team and requester.
- Subjects are prefixed as `[DEV e-Credit]`, `[QAS e-Credit]`, or `[e-Credit]`.

For request data, `services/requestEmailModelService.js` exposes
`getRequestEmailModel(requestId, dear)`. It loads the Request with Size, Rating, and Term
associations and uses `CUSTOMER_CUSTOMER_TYPE_EXTER` for Customer Type.

## Available Environments

Start the API for a specific environment:

```bash
npm run start:dev    # PORT 3035, NODE_ENV=dev
npm run start:qas    # PORT 3035, NODE_ENV=qas
npm run start:prd    # PORT 3035, NODE_ENV=prd
```

**Important**: Only routes for the active environment are exposed.

- `NODE_ENV=dev` exposes only `/dev/api/*`
- `NODE_ENV=qas` exposes only `/qas/api/*`
- `NODE_ENV=prd` exposes only `/prd/api/*`

Cross-environment routes return 404.

All environments use the same files directly under `controllers/` and `routes/`.
`routes/api.js` aggregates the shared API and `routes/index.js` mounts it at the
active prefix. No CRM simulation endpoint is exposed. Normal workflows synchronize automatically when a request becomes
Cancelled, Completed, or Rejected. System Admin Change Status offers an opt-in
Salesforce checkbox for only those three statuses. OAuth credentials are sent in a
form-encoded POST body; credit updates use a Bearer token and JSON payload.
Each Salesforce endpoint attempt is recorded separately in Event Logs without
storing credentials or access tokens. If Salesforce synchronization fails
after the eCredit status is committed, the API returns the CRM failure and the
frontend displays a support modal. There are no environment-specific controller
or route folders.

## API Endpoints

### Public Endpoints

#### GET `/api/home`
Returns API information and status
```json
{
  "success": true,
  "data": {
    "apiName": "e-Credit Express API",
    "environment": "dev",
    "status": "operational"
  },
  "correlationId": "uuid"
}
```

#### GET `/api/health/live`
Liveness probe - indicates if application is running
```json
{
  "success": true,
  "data": { "status": "live", "timestamp": "2026-08-05T10:00:00Z" },
  "correlationId": "uuid"
}
```

#### GET `/api/health/ready`
Readiness probe - indicates if application is ready to handle requests

#### GET `/api/docs`
Swagger UI interface for interactive API exploration

#### GET `/api/docs/openapi.json`
OpenAPI 3.x specification as JSON

### Protected Endpoints (Require Authentication)

#### GET `/api/auth/me`
Returns authenticated user profile
**Header**: `Authorization: Bearer <msal_access_token>`
```json
{
  "success": true,
  "data": {
    "oid": "user-object-id",
    "tid": "tenant-id",
    "email": "user@company.com",
    "displayName": "John Doe",
    "roles": ["admin"]
  },
  "correlationId": "uuid"
}
```

#### GET `/api/session/ping`
Validates session and resets idle timeout
**Header**: `Authorization: Bearer <msal_access_token>`
```json
{
  "success": true,
  "data": { "message": "pong", "timestamp": "2026-08-05T10:00:00Z" },
  "correlationId": "uuid"
}
```

## Authentication

The API uses **Microsoft Entra ID (Azure AD)** with MSAL for authentication.

### Token Requirements

Access tokens must be:
1. Issued for the e-Credit Express API application (client ID: `94ea24c7-b390-4ef8-9f97-c9b4bebe3298`)
2. Requested with scope: `api://94ea24c7-b390-4ef8-9f97-c9b4bebe3298/access_as_user`
3. Valid and not expired
4. Signed with RS256 algorithm
5. From the configured single-tenant (tenant ID: `c5e7210b-25bc-45c8-ad35-0ac4c50ca2f4`)

### Token Validation

The API validates:
- JWT signature (using MSAL public keys)
- Expiration time
- Intended audience
- Issuer
- Tenant ID
- Delegated scope (`access_as_user`)

### Invalid Token Errors

```json
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_TOKEN",
    "message": "Authentication token is invalid or expired."
  },
  "correlationId": "uuid"
}
```

## HTTPS and Certificates

The API requires HTTPS on port 3035. Certificates are loaded from UNC paths during startup.

### Certificate Configuration

Set in `.env` files:
```
KEY_PATH=\\Cloudapp02\d\Certificates\private.key
CERT_PATH=\\Cloudapp02\d\Certificates\bigth.crt
CA_PATH=\\Cloudapp02\d\Certificates\CA_root.crt
```

### Service Account Permissions

The Windows service account running Node.js must have **read access** to:
- Private key file
- Certificate files
- CA root certificate

Verify permissions:
```powershell
Get-Acl "\\Cloudapp02\d\Certificates\"
```

### Troubleshooting

If certificates cannot be loaded:
1. Verify service account has read permissions
2. Check certificate file paths are correct
3. Ensure certificate files are not corrupted
4. Check Windows firewall allows access to network share

## Database

### SQL Server Configuration

Configured via environment variables:
```
DB_SERVER=clouddb01
DB_INSTANCE_NAME=dev
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=***
DB_NAME=eCredit
DB_ENCRYPT=false (dev), true (qas/prd)
DB_TRUST_SERVER_CERTIFICATE=true (dev), false (qas/prd)
DB_POOL_MIN=2
DB_POOL_MAX=10 (dev/qas), 20 (prd)
```

### Connection Pooling

- Minimum connections: 2 (dev/qas), 5 (prd)
- Maximum connections: 10 (dev/qas), 20 (prd)
- Acquire timeout: 30 seconds
- Idle timeout: 10 seconds

### Database Connection

The app connects to the database during startup. If the connection fails, the application will exit with a fatal error.

To test connectivity:
```bash
npm run start:dev  # Check logs for connection status
```

## Logging

### Log Files

Logs are written to daily-rotating text files in the `logs/` directory:

- `ecredit-dev-YYYY-MM-DD.txt` - Dev application logs
- `ecredit-error-dev-YYYY-MM-DD.txt` - Dev error logs
- `ecredit-qas-YYYY-MM-DD.txt` - QAS application logs
- `ecredit-error-qas-YYYY-MM-DD.txt` - QAS error logs
- `ecredit-prd-YYYY-MM-DD.txt` - PRD application logs
- `ecredit-error-prd-YYYY-MM-DD.txt` - PRD error logs

### Log Format

Logs include:
- Timestamp (ISO 8601)
- Log level (debug, info, warn, error)
- Environment name
- Correlation ID (for request tracing)
- HTTP method and route (for request logs)
- Status code and response time
- Error messages

### Sensitive Data Redaction

The logger automatically redacts:
- Authorization headers
- Access tokens
- Database passwords
- Client secrets
- Certificate contents

Example redacted log:
```
[2026-08-05 10:00:00] [WARN] [dev] [abc-123] POST /dev/api/home - 401 (45ms)
Authorization: ***REDACTED***
access_token: ***REDACTED***
```

### Console Output

- **Development** (`NODE_ENV=dev`): Application logs printed to console (useful for debugging)
- **QAS/PRD** (`NODE_ENV=qas|prd`): No console output (logs to files only)

## API Response Format

All API responses follow a standard envelope:

### Success Response (2xx)
```json
{
  "success": true,
  "data": { /* response-specific data */ },
  "correlationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Error Response (4xx, 5xx)
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  },
  "correlationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Correlation ID

All responses include a correlation ID for request tracing. The ID is:
1. Extracted from `X-Correlation-ID` request header (if provided)
2. Generated as a new UUID (if not provided)
3. Included in all response headers and JSON body
4. Logged with all related log entries

Use correlation IDs to trace requests across logs and multiple services.

## Error Codes

Standard error codes returned by the API:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_MISSING_TOKEN` | 401 | Authorization header not provided |
| `AUTH_INVALID_TOKEN` | 401 | Token is invalid or malformed |
| `AUTH_TOKEN_EXPIRED` | 401 | Token has expired |
| `AUTH_INVALID_AUDIENCE` | 401 | Token intended for different API |
| `AUTH_INVALID_ISSUER` | 401 | Token issuer not trusted |
| `AUTH_INVALID_TENANT` | 401 | Token from unauthorized tenant |
| `AUTH_INSUFFICIENT_SCOPE` | 401 | Token missing required scope |
| `FORBIDDEN` | 403 | User lacks required permissions |
| `NOT_FOUND` | 404 | Requested resource not found |
| `VALIDATION_ERROR` | 400 | Request data validation failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | Database or external service unavailable |

## Middleware Chain

Requests are processed through this middleware chain:

1. **Helmet** - Security headers (HSTS, CSP, etc.)
2. **Correlation ID** - Generate or extract request ID
3. **CORS** - Cross-origin request validation
4. **JSON Parser** - Parse request body
5. **Rate Limiter** - Protect against abuse (100 req/15min per IP)
6. **Request Logger** - Log incoming requests
7. **Environment Router** - Route to /dev, /qas, or /prd handler
8. **Authentication** - Validate JWT token (if required)
9. **Error Handler** - Catch and format errors

## Project Structure

```
ecredit-services/
├── app.js                          # Express server entry point
├── package.json                    # Dependencies and scripts
├── .env.dev, .env.qas, .env.prd   # Environment configuration
├── .env.example                    # Configuration template
├── .gitignore                      # Git ignore rules
├── .eslintrc.js                    # ESLint configuration
├── .prettierrc.json                # Prettier code formatting
├── jest.config.js                  # Jest testing configuration
│
├── config/                         # Application configuration
│   ├── env.js                      # Environment validation
│   ├── logger.js                   # Winston logger setup
│   ├── database.js                 # Sequelize ORM configuration
│   ├── https.js                    # HTTPS certificate loading
│   └── swagger.js                  # Swagger/OpenAPI configuration
│
├── middlewares/                    # Express middleware
│   ├── correlationId.js            # Request ID middleware
│   ├── requestLogger.js            # Request logging middleware
│   ├── errorHandler.js             # Error handling middleware
│   ├── authentication.js           # JWT validation middleware
│   └── cors.js                     # CORS configuration middleware
│
├── helpers/                        # Utility functions
│   ├── tokenValidator.js           # JWT token validation
│   └── errorCodes.js               # Standard error codes
│
├── models/                         # Sequelize database models
│   ├── user.js                     # User model
│   └── auditLog.js                 # Audit log model
│
├── routes/                         # API routes
│   ├── index.js                    # Environment router loader
│   ├── dev/                        # DEV environment routes
│   │   ├── index.js
│   │   ├── homeRoute.js
│   │   ├── authRoute.js
│   │   ├── sessionRoute.js
│   │   ├── healthRoute.js
│   │   └── docsRoute.js
│   ├── qas/                        # QAS environment routes (same structure)
│   └── prd/                        # PRD environment routes (same structure)
│
├── controllers/                    # Route handlers
│   ├── dev/                        # DEV environment controllers
│   │   ├── homeController.js
│   │   ├── authController.js
│   │   └── sessionController.js
│   ├── qas/                        # QAS environment controllers
│   └── prd/                        # PRD environment controllers
│
├── logs/                           # Application logs (git-ignored)
│   ├── ecredit-dev-*.txt
│   ├── ecredit-error-dev-*.txt
│   ├── ecredit-qas-*.txt
│   └── ecredit-error-qas-*.txt
│
└── tests/                          # Unit and integration tests
    ├── config/
    ├── middlewares/
    ├── controllers/
    └── integration/
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for IIS and Windows service setup.

## Security

See [SECURITY.md](SECURITY.md) for authentication, token validation, and credential management.

## Support

For issues or questions, contact the e-Credit development team.
