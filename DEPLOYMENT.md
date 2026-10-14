# Deployment Guide

## Prerequisites

- Windows Server with IIS installed
- Node.js 22.12.0 installed on target server
- SQL Server with eCredit database created
- HTTPS certificates on network share (\\Cloudapp02\d\Certificates\)
- Service account with appropriate permissions

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
