# e-Credit Backend Agent Guide

## Scope and sources of truth

- This guide applies only to `ecredit-services/`. Do not change the sibling frontend or root-level `migrations/` project unless the task explicitly asks for it.
- Read the relevant sections of [README.md](./README.md), [DEPLOYMENT.md](./DEPLOYMENT.md), and [SECURITY.md](./SECURITY.md) before changing related behavior. Prefer current source and tests when documentation disagrees; update directly related documentation when behavior changes.
- Keep credentials, tokens, private keys, signed URLs, and populated `.env.*` values out of source, tests, documentation, logs, and responses. Use `.env.example` for configuration shape.

## Architecture and conventions

- The service is Node.js 22.12.0, Express, and CommonJS. Follow the existing route → middleware/controller → service/model boundaries and shared API route structure.
- The same API serves `dev`, `qas`, and `prd` under `/<env>/api`. Keep environment selection in `config/` and the matching environment configuration; do not duplicate route or controller logic per environment.
- SQL Server access uses Sequelize. Database schema changes are explicit migrations; the API does not automatically migrate or synchronize the database at startup. Check migration requirements and environment targeting before describing a feature as deploy-ready.
- Follow `.eslintrc.js`: single quotes, semicolons, two-space indentation, and the existing error-handling patterns. Reuse existing validation, response, logging, and authorization helpers.
- Treat authorization as a backend responsibility. Verify actual middleware and role checks in source; hiding frontend navigation is not access control. When changing authentication, inspect `helpers/tokenValidator.js` and keep security documentation consistent with its actual behavior.

## API documentation

- `config/swagger.js` is the OpenAPI source; `routes/api.js` and its mounted route modules define the actual API surface.
- Keep every documented operation, schema, security rule, status code, and maintenance behavior aligned with route/controller behavior. When adding or removing routes, update the OpenAPI documentation and the operation-count/regression assertions in `__tests__/environmentIsolation.test.js`.
- The current contract documents 87 operations. Recount against mounted routes when the API changes; do not assume that number remains permanent.

## Build, lint, and test

Run commands from this directory. Use the smallest relevant checks, then broaden validation when warranted:

```powershell
npm run lint
npm test
npx jest --runInBand __tests__/environmentIsolation.test.js
npm run start:dev
npm run start:qas
npm run start:prd
```

`npm test` runs Jest with coverage. Do not claim a check passed unless it completed successfully. Do not start a production service or run migrations against a shared database as part of routine validation.

## Change record

- **2026-11-05** — Replaced Customer Extension Basic Information request-snapshot expressions with live Salesforce projections by TAX_NO, using consistent account ordering and company-master join. No Basic fields persist in CUSTOMERS; Request snapshots/ID-first lookups are unchanged. Withdrew the proposed customer snapshot migration and removed the frontend Tax-ID-as-Sold-To fallback. Updated runtime/deployment/UI docs. Jest: 97 passed; Chrome Headless: 3 passed. No live SQL or database/schema changes performed.
- **2026-11-05** — Prepared manual `database/migrations/20261105_add_customer_basic_information.sql`: eight nullable varchar Customer Basic Information snapshot fields, guarded per column with transactional rollback; TAX_NO business key retained, no SOLD_ID/key/data changes or backfill. Updated deployment steps; runtime snapshot integration is pending operator confirmation of schema preparation. Static migration safeguards passed; SQL Server execution not performed.
- **2026-11-05** — Revised only Sold-To dropdown membership: selected Sales Group yields Sold-To numbers, those numbers select `Customer Sold-To Read Only` account IDs, and the outer read-only query filters by those IDs. Retained parameter binding, existing search/company fields and result limit; changed ordering to `SC.Id`. Focused Jest: 12 passed; no database changes or live SQL execution.
- **2026-11-05** — Changed only the Sold-To dropdown Sales Group filter to `SC.Id IN (SELECT SG.Id FROM dbo.S_SalesforceAccount AS SG WHERE SG.Sales_Group__c = :salesGroup)` while retaining the outer RecordTypeName filter, explicit comparison collation and existing search/company mapping. Focused Jest: 12 passed, including all four supported groups; no database changes or live SQL execution.
- **2026-11-05** — Restricted only `searchSoldToCustomers` dropdown results to `RecordTypeName = 'Customer Sold-To Read Only'`; preserved Sales Group/search filters and all other customer/request queries. Updated README and scoped regression assertions. Focused Jest: 8 passed; no database changes or live SQL execution.
- **2026-11-05** — Follow-up: restored Tax-ID-only Customer Extensions after customer-list timeout report. Removed customer Account-ID model/query/payload validation/audit dependencies and nested ID-resolution subqueries; source tax columns stay unwrapped with conversion/collation on the customer value. Kept Salesforce master, latest request snapshots, name ordering, and Request SOLD_ID behavior. Existing CUSTOMERS.SOLD_ID column/data are unused, not removed; no timeout configuration or database schema changed. Updated Swagger/docs and list/payload regressions. Jest: 91 passed; Chrome Headless: 2 passed. Live SQL performance not verified.
- **2026-11-05** — Replaced legacy customer/Sold-To and MDCENTER customer queries with `S_SalesforceAccount`/`S_CompanyMaster` in customer/request services. Added ID-first `SOLD_ID` resolution/models, Account/Tax-ID validation and auditing; retained request snapshots and tax-only legacy fallback with explicit cross-source collation. Updated Swagger, README and deployment prerequisites for operator-applied varchar schema. Focused Jest: 92 passed, including dev/qas/prd contracts; frontend Chrome Headless: 2 passed; TypeScript and dev build passed. Scoped ESLint found only the existing requestService indentation error (also reproduced on HEAD); no live SQL, migration, API restart or legacy-object deletion performed.
- For every task that changes backend code, tests, configuration, API documentation, or other backend files, add a concise dated entry to this section before finishing. This includes documentation-only changes. Record the request/change, important paths, and checks actually run; do not duplicate full implementation details or include secrets.
- Add newest entries first. Do not add entries for questions, plans, or investigations that make no file changes.
- **2026-11-03** — Added `TERMS.EXPOSURE` to the Sequelize term model and `/requests/terms` response as numeric/null; documented `TermOption` in Swagger. Approval term thresholds now use exposure bands 0–30, >30–60, and >60 instead of hardcoded term IDs. Focused frontend workflow spec: 8 passed; `build:dev` passed; term metadata Jest: 1 passed; backend scoped ESLint passed.
- **2026-11-03** — Added raw LOGS ID/NAME/CATEGORY fields with global filtering/sorting, and `services/logRetentionService.js` for physical 90-day deletion in 1,000-row batches after startup and hourly, with graceful shutdown in `app.js`. Applied user-selected suppression of routine successful token/auth/read debug diagnostics and successful session heartbeats; preserved Login audits, changes and failures. Updated API/security/deployment documentation. Focused Jest: 76 passed; scoped ESLint passed except 4 pre-existing `app.js` issues (unused variables/trailing spaces). No live cleanup or API restart performed; no migration required.
- **2026-11-03** — Expanded Administration Event Logs to include authenticated `/auth/me` loads and data changes without an eCredit request; stopped recording routine reads and hid historical read events in the global list. Updated `services/eventLogService.js`, its global regression tests, README, SECURITY, and Swagger. Focused Jest: 40 passed; full Jest: 544 passed, 4 failed in unrelated email reminder/config/Salesforce-link tests. Scoped ESLint and `git diff --check` passed. No migration or frontend changes required.
- **2026-11-03** — Created this backend guide and established the per-change recording requirement.
- **2026-11-03** — Documented all 87 backend API operations and added Swagger regression assertions in `config/swagger.js` and `__tests__/environmentIsolation.test.js`. Jest passed for dev/qas/prd; ESLint, OpenAPI parser validation, and `git diff --check` passed.
