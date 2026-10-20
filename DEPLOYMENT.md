# Deployment Guide

## Prerequisites

- Windows Server with IIS installed
- Node.js 22.12.0 installed on target server
- SQL Server with eCredit database created
- HTTPS certificates on network share (\\Cloudapp02\d\Certificates\)
- Service account with appropriate permissions

## Runtime Environment

Deploy the same controller and route structure for every branch. Select the runtime
with `npm run start:dev`, `npm run start:qas`, or `npm run start:prd`; each command
loads `.env.dev`, `.env.qas`, or `.env.prd` respectively. NSSM services select the same
configuration using `NODE_ENV`, as shown below. API prefixes remain `/<env>/api`.

Database selection comes only from the active environment configuration, not folder
names. Check `DB_SERVER`, `DB_INSTANCE_NAME`, `DB_PORT`, `DB_NAME`, credentials, and
TLS settings before deployment. Process-level variables override values in the file;
remove stale database variables inherited from other environments.

PRD sends workflow email to real recipients with the configured audit BCC. DEV/QAS
send only to the current logged-in tester, with no CC/BCC, including resends and
View As sessions. If an email action has no logged-in tester context in DEV/QAS,
the notification is not sent; it never falls back to the audit mailbox.

## Scheduled Maintenance

Before deploying, run
[`database/migrations/20261020_add_maintenance.sql`](database/migrations/20261020_add_maintenance.sql)
against **each environment's own database**. This transactional, rerunnable migration
creates and seeds `MAINTENANCE_CONFIG` disabled without overwriting existing settings.
There is no automatic schema synchronization or migration at startup. No new environment
variables are required. DEV/QAS/PRD must use distinct databases to keep their settings independent.

`GET /<env>/api/maintenance` is public and returns
`{success:true,data:{enabled,active,message,startsAt,endsAt,serverTime,canBypass}}`.
An optional bearer token resolves `canBypass` from the actual logged-in System Admin
role, even while inactive; Super User, token role claims, and View As roles do not grant bypass.
`PUT /<env>/api/maintenance` requires an authenticated actual System Admin and accepts
`{enabled:boolean,message:string,startsAt:string|null,endsAt:string|null}`.
Enabled schedules require a nonblank message (maximum 4000 characters) and both timestamps
with `endsAt > startsAt`. Use ISO timestamps with an explicit timezone; responses are UTC ISO.
Dates persist as SQL Server `DATETIMEOFFSET(3)`; audit timestamps use `SYSUTCDATETIME()`
and record the actual logged-in employee, not the viewed employee. Keep server clocks synchronized.
Both status/configuration responses use `Cache-Control: no-store`.

Maintenance is active exactly when `enabled && startsAt <= serverTime < endsAt`.
No timer or service restart is needed. During the window all API routes, including CRM
and public email approval display/confirmation, return HTTP 503 to non-System Admins:
`{success:false,error:{code:"SYSTEM_MAINTENANCE",message},data:<public-state>,correlationId}`.
Email approval tokens never grant bypass. The gate runs inside the environment API router,
after CORS/preflight handling. Only health, maintenance GET/PUT, GET `/auth/me`,
GET `/permissions/me`, GET `/session/ping`, and POST `/session/presence` are exempt;
bootstrap endpoints retain their existing authentication. Other permission writes remain gated.
Missing/malformed settings or identity lookup failures propagate to the standard logged
error handler, never silently disable maintenance.

Automatic reminders pause at each poll and before starting each delivery during active
maintenance, without advancing delivery state. Already-started requests/email deliveries
are not cancelled. Overdue reminders resume after the window using existing cooldown rules.

**Existing authentication limitation:** the shared `helpers/tokenValidator.js` currently
decodes tokens and checks claims but does not cryptographically verify Entra signatures.
Maintenance deliberately uses the existing authentication pipeline; production assurance of
actual identity requires separately hardening that shared validator (or verified upstream
authentication). Maintenance role checks do not fix that pre-existing authentication issue.

## Email Reminders

Before deploying this feature, run
[`database/migrations/20261016_add_email_reminders.sql`](database/migrations/20261016_add_email_reminders.sql)
against each environment's database. The script is transactional and rerunnable;
it preserves existing configuration and delivery state. No automatic schema sync
or migration is performed by the API.

The migration creates:

- `EMAIL_REMINDER_CONFIGS`: the requested audit columns (`ID VARCHAR(128)`,
  `CREATED_DATE`, `UPDATED_DATE`, `CREATED_BY`, `UPDATED_BY`, `ENABLED DEFAULT 1`,
  nullable `SORTING`), plus unique `TEMPLATE`, `INTERVAL_VALUE`, `INTERVAL_UNIT`.
- `EMAIL_REMINDER_STATES`: durable per-request/template/approval delivery state,
  including `SOURCE_EMAIL_ID`, `LAST_SENT_DATE`, `LAST_ATTEMPT_DATE`, `SENT_COUNT`
  and `LAST_ERROR`. This prevents a service restart from resetting reminder rounds.
  Audit employee code `0` denotes the automatic scheduler and migration seed.

Reminder audit and delivery timestamps are written with SQL Server `GETDATE()`.
Keep these writes database-side: Sequelize serializes JavaScript `Date` values
with a timezone suffix, which is incompatible with the existing `DATETIME` columns.

All four initial settings are deliberately **disabled**, with a one-day interval.
System Admin / Super User can configure them in **Administration > Email Reminders**.
Each template has an enable checkbox and a whole-number interval (1-365) in minutes,
hours or days. Saving affects the next scheduler check; no restart is needed.
Enabling a template includes already-overdue eligible historical logs, so review
the backlog before enabling it in PRD.

| Template | Initial timer | Stops when |
| --- | --- | --- |
| `request-approval.hbs` | Original successful email delivery; Save alone does not reset the timer | The specific approver approves/rejects/sends backward, leaves the current pending step/cycle, or request leaves Waiting Approval |
| `request-backward.hbs` | Latest current-cycle Backward approval `UPDATED_DATE`, including disabled approval history | Request leaves Draft (resubmit/cancel); editing alone does not stop/reset it |
| `request-draft.hbs` | `REQUESTS.UPDATED_DATE`; edits restart the timer | Request status changes from Draft; submission or Backward history does not independently affect eligibility |
| `request-final.hbs` | Latest current-cycle Approved approval `UPDATED_DATE` | Request leaves Final (complete/cancel); editing alone does not stop/reset it |

Only successful original email logs in the active environment are sources.
Reminders and manual resends are not new reminder sources. The latest original
log per request/template is used (per approval ID for approval emails, including
parallel approvers). The original To/CC/BCC and base subject are reused, current
request content is rebuilt, and approval action links are freshly signed.
Draft reminders require that the original `request-draft` log is the only
non-automatic `request-draft` log for that request. Logs created by automatic
Draft reminders do not count; a manual resend or another Draft email log makes
the request ineligible for Draft reminders.
Draft sources also accept category `api.crm.email` when `DESCRIPTION.template`
is `request-draft` or `request-draft.hbs`. These logs participate in the same
single-original-log rule. Stored `sendParameters` and matching runtime
environment are still required; changing the category filter does not convert
the external API's flat log payload into send parameters.
Reminder subjects start with `Reminder!! [e-Credit]`, `Reminder!! [QAS e-Credit]`
or `Reminder!! [DEV e-Credit]`, followed by the original subject text. The four
reminder templates render a red `Reminder!!` banner only when the email service
sets `isReminder` from automatic reminder metadata. Ordinary workflow emails and
ordinary manual resends do not display the banner. Resending a reminder from
Email Logs preserves its reminder metadata and presentation.
DEV/QAS reuse only the single original To recipient from the log, without CC/BCC
(legacy CC/BCC entries are discarded rather than blocking delivery); they
never send to a real approver as a fallback. Historical approval logs use their
signed action links to identify the approver even after token expiry; logs with
missing/invalid approval identity are skipped with an explicit server error log.
Drafts without an original draft email log are intentionally not mailed; this
feature does not introduce an initial draft-email sender.

The API worker checks approximately every minute while the process is running.
Reminders repeat without a maximum until the stop condition applies, with one
configured interval after each successful send or failed attempt. Downtime does
not cause catch-up bursts. Results are written to Email Logs with `resendOf` and
`reminderContext.automatic`; detailed failure/cooldown state is persisted in
`EMAIL_REMINDER_STATES`. Scheduler/configuration/database errors are also logged
by the standard server logger.

Multiple instances coordinate via SQL Server `sys.sp_getapplock` inside a
per-reminder transaction, rechecking configuration, eligibility and durable
state after acquiring the lock. The database user needs permission to execute
`sys.sp_getapplock`. Scheduler runs do not overlap within a process, and graceful
shutdown stops the worker before closing the database. As with SMTP generally,
delivery is at-least-once: a process/database failure after SMTP acceptance but
before committing state can cause a duplicate on a later check.

The administration API uses the standard authentication and admin-role checks:
`GET /<env>/api/email-reminders` and
`PATCH /<env>/api/email-reminders/:template`, with body
`{ "enabled": true, "intervalValue": 2, "intervalUnit": "days" }`.

## Windows Service Setup (NSSM)

The application is managed as a Windows service using NSSM (Node Service Manager).

### Install Node Service Manager

```powershell
# Download and install NSSM from https://nssm.cc/download
# Or install via Chocolatey:
choco install nssm
```

### Create Windows Service

```powershell
# Create service for dev environment
nssm install node-app-ecredit-dev "C:\Program Files\nodejs\node.exe" "D:\web_is\Services\iisnode\ecredit-services\app.js"

# Set environment variables
nssm set node-app-ecredit-dev AppEnvironmentExtra NODE_ENV=dev
nssm set node-app-ecredit-dev AppDirectory "D:\web_is\Services\iisnode\ecredit-services"

# Set the matching environment for QAS/PRD services as well
nssm set node-app-ecredit-v2-qas AppEnvironmentExtra NODE_ENV=qas
nssm set node-app-ecredit-v2 AppEnvironmentExtra NODE_ENV=prd

# Set startup type
nssm set node-app-ecredit-dev Start SERVICE_AUTO_START

# Start service
nssm start node-app-ecredit-dev
```

### Service Management Commands

```powershell
# Start service
nssm start node-app-ecredit-dev

# Stop service
nssm stop node-app-ecredit-dev

# Restart service
nssm restart node-app-ecredit-dev

# View service status
nssm status node-app-ecredit-dev

# Remove service
nssm remove node-app-ecredit-dev confirm
```

## IIS Configuration

The Node.js application runs independently on port 3035 (HTTPS). IIS can act as a reverse proxy.

### Option 1: Application Gateway / Reverse Proxy

If using IIS as a reverse proxy:

The API trusts forwarded client addresses only when the connection comes from
the local machine. Keep the IIS proxy target on `localhost` so rate limiting
uses the originating client address without trusting forwarded headers from
direct clients.

```xml
<!-- web.config for IIS -->
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Node Proxy">
          <match url="(.*)" />
          <action type="Rewrite" url="https://localhost:3035/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

### Option 2: Standalone HTTPS

Run Node.js directly on port 3035 (HTTPS) without IIS reverse proxy.

## Service Account Permissions

The Windows service account must have read access to:

### Certificate Files
```
\\Cloudapp02\d\Certificates\
  - private.key
  - bigth.crt
  - CA_root.crt
```

Set NTFS permissions:
```powershell
$path = "\\Cloudapp02\d\Certificates"
$user = "DOMAIN\ServiceAccount"
$acl = Get-Acl $path
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $user, 
  "Read", 
  "ContainerInherit,ObjectInherit", 
  "None", 
  "Allow"
)
$acl.SetAccessRule($rule)
Set-Acl -Path $path -AclObject $acl
```

### Database Access

Ensure service account can connect to SQL Server:
```sql
-- SQL Server
CREATE LOGIN [DOMAIN\ServiceAccount] FROM WINDOWS;
USE eCredit;
CREATE USER [DOMAIN\ServiceAccount] FOR LOGIN [DOMAIN\ServiceAccount];
ALTER ROLE db_datareader ADD MEMBER [DOMAIN\ServiceAccount];
ALTER ROLE db_datawriter ADD MEMBER [DOMAIN\ServiceAccount];
ALTER ROLE db_ddladmin ADD MEMBER [DOMAIN\ServiceAccount];
```

### Application Directory

Grant full control to service account on application directory:
```powershell
$path = "D:\web_is\Services\iisnode\ecredit-services"
$user = "DOMAIN\ServiceAccount"
$acl = Get-Acl $path
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  $user, 
  "FullControl", 
  "ContainerInherit,ObjectInherit", 
  "None", 
  "Allow"
)
$acl.SetAccessRule($rule)
Set-Acl -Path $path -AclObject $acl
```

## Environment Configuration

### Create Environment Files

Copy `.env.example` to each environment file and fill in actual values:

```bash
# D:\web_is\Services\iisnode\ecredit-services\.env.dev
NODE_ENV=dev
PORT=3035
DB_SERVER=clouddb01
DB_INSTANCE_NAME=dev
DB_USER=<service_account>
DB_PASSWORD=<secure_password>
DB_NAME=eCredit
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true

KEY_PATH=\\Cloudapp02\d\Certificates\private.key
CERT_PATH=\\Cloudapp02\d\Certificates\bigth.crt
CA_PATH=\\Cloudapp02\d\Certificates\CA_root.crt

MSAL_TENANT_ID=c5e7210b-25bc-45c8-ad35-0ac4c50ca2f4
# ... other required variables
```

### Secure Configuration

**DO NOT commit .env files to Git**

Store sensitive configuration in:
1. Environment files (not in Git)
2. Windows environment variables
3. Azure Key Vault (if available)
4. Secret management system

## Deployment Steps

### 1. Clone or Copy Source

```powershell
cd D:\web_is\Services\iisnode
git clone https://[your-repo] ecredit-services
# OR copy files from GitHub Actions deployment
```

### 2. Install Dependencies

```powershell
cd D:\web_is\Services\iisnode\ecredit-services
npm install --production  # Use --production to skip dev dependencies
```

### 3. Create .env Files

Copy `.env.example` and configure for each environment:
```powershell
Copy-Item .env.example .env.dev
# Edit .env.dev with actual configuration
```

### 4. Create Logs Directory

```powershell
mkdir logs
```

### 5. Start Service

```powershell
nssm start node-app-ecredit-dev
```

### 6. Verify Startup

Check service is running:
```powershell
nssm status node-app-ecredit-dev
```

Test API endpoint:
```bash
curl -k https://localhost:3035/dev/api/home
```

Check logs:
```powershell
Get-Content logs/ecredit-dev-*.txt -Tail 50
```

## Monitoring

### Windows Event Viewer

Monitor Windows Event Log for application events:
```powershell
Get-EventLog -LogName Application -Source Node | Select-Object -Last 20
```

### Application Logs

Check daily rotating log files:
```powershell
ls logs/ecredit-*.txt
tail -f logs/ecredit-dev-*.txt
```

### Health Check Endpoint

Monitor API health:
```bash
curl -k https://localhost:3035/dev/api/health/live
curl -k https://localhost:3035/dev/api/health/ready
```

## Troubleshooting

### Service Won't Start

1. Check service log:
   ```powershell
   nssm query node-app-ecredit-dev
   ```

2. Check application logs:
   ```powershell
   ls logs/ | Sort-Object -Property LastWriteTime -Descending | Select-Object -First 5
   tail -f logs/ecredit-error-*.txt
   ```

3. Check environment variables:
   ```powershell
   nssm dump node-app-ecredit-dev
   ```

### Certificate Loading Errors

1. Verify service account has read access:
   ```powershell
   $user = "DOMAIN\ServiceAccount"
   Test-Path "\\Cloudapp02\d\Certificates\private.key" -PathType Leaf
   ```

2. Check certificate file permissions:
   ```powershell
   Get-Acl "\\Cloudapp02\d\Certificates" | Format-List
   ```

3. Test certificate readability:
   ```powershell
   Get-Content "\\Cloudapp02\d\Certificates\private.key" -ErrorAction Stop
   ```

### Database Connection Errors

1. Test SQL Server connectivity:
   ```powershell
   sqlcmd -S clouddb01\dev -U sa -P <password> -Q "SELECT @@VERSION"
   ```

2. Verify database exists:
   ```sql
   SELECT name FROM sys.databases WHERE name = 'eCredit'
   ```

3. Check service account permissions:
   ```sql
   SELECT * FROM sys.server_principals WHERE name LIKE '%ServiceAccount%'
   USE eCredit;
   SELECT * FROM sys.database_principals WHERE name LIKE '%ServiceAccount%'
   ```

## Rollback

To rollback to previous version:

```powershell
# Stop service
nssm stop node-app-ecredit-dev

# Restore previous source files
# (from backup or previous commit)

# Restart service
nssm start node-app-ecredit-dev

# Verify startup
nssm status node-app-ecredit-dev
```

## Upgrading

To upgrade to new version:

```powershell
# Stop service
nssm stop node-app-ecredit-dev

# Backup current version
Copy-Item ecredit-services ecredit-services.backup -Recurse

# Pull/copy new source
git pull
# OR copy from deployment

# Install new dependencies
npm install --production

# Start service
nssm start node-app-ecredit-dev

# Verify startup
nssm status node-app-ecredit-dev
tail -f logs/ecredit-dev-*.txt
```

## Performance Tuning

### Node.js Heap Size

For large workloads, increase Node.js heap:

```powershell
nssm set node-app-ecredit-dev AppParameters "--max-old-space-size=2048 D:\web_is\Services\iisnode\ecredit-services\app.js"
```

### Database Connection Pool

Adjust in `.env` files:
```
DB_POOL_MIN=5
DB_POOL_MAX=20
```

### Rate Limiting

Adjust in `app.js`:
```javascript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,  // Increase from 100 if needed
});
```

## Backup and Recovery

### Backup Strategy

1. **Source Code**: Git repository (pushed regularly)
2. **Configuration**: .env files (not in Git, backed up separately)
3. **Database**: SQL Server backup jobs
4. **Logs**: Archived after retention period

### Recovery Procedure

1. Restore source from Git
2. Restore .env files from secure backup
3. Restore database from SQL Server backup
4. Restart service
5. Verify connectivity with health checks
