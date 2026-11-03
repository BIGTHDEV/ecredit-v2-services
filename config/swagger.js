const swaggerJsdoc = require('swagger-jsdoc');
const config = require('./env');

const paths = {};

const requestBody = (schema, description, required = true) => ({
  required,
  description,
  content: {
    'application/json': {
      schema,
    },
  },
});

const response = (description, schema = '#/components/schemas/SuccessResponse') => ({
  description,
  content: {
    'application/json': {
      schema: typeof schema === 'string' ? { $ref: schema } : schema,
    },
  },
});

const successResponseSchema = (dataSchema) => ({
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: dataSchema,
    correlationId: { type: 'string', format: 'uuid' },
  },
});

const pathParameter = (name, schema = { type: 'string' }) => ({
  name,
  in: 'path',
  required: true,
  schema,
});

const endpoints = [
  ['get', '/home', 'Public', 'Get API information', 'Returns the API name, active environment, version, operational status, and server timestamp.', { public: true, dataSchema: { $ref: '#/components/schemas/ApiInfo' } }],
  ['get', '/auth/me', 'Authentication', 'Get current user', 'Returns the authenticated Microsoft Entra ID user and e-Credit profile.', { maintenanceExempt: true, dataSchema: { $ref: '#/components/schemas/AuthenticatedUser' } }],
  ['get', '/session/ping', 'Session', 'Keep session alive', 'Validates the current access token and returns a minimal response for client-side session monitoring.', { maintenanceExempt: true, dataSchema: { $ref: '#/components/schemas/SessionPing' } }],
  ['post', '/session/presence', 'Session', 'Update tab presence', 'Records whether a browser tab for the authenticated user is active or away. The heartbeat is held in memory and returns no content.', {
    body: requestBody({ $ref: '#/components/schemas/PresenceUpdate' }, 'Browser tab presence state.'),
    status: 204,
    maintenanceExempt: true,
  }],
  ['get', '/health/live', 'Health', 'Check liveness', 'Liveness probe; confirms the process is responding. Does not verify database readiness.', { public: true, maintenanceExempt: true, dataSchema: { $ref: '#/components/schemas/HealthData' } }],
  ['get', '/health/ready', 'Health', 'Check readiness endpoint', 'Returns the health heartbeat payload. This route currently uses the same handler as /health/live and does not perform a database readiness check.', { public: true, maintenanceExempt: true, dataSchema: { $ref: '#/components/schemas/HealthData' } }],
  ['post', '/health/crm', 'Health', 'Check CRM readiness', 'Checks the Salesforce/CRM synchronization readiness for the current environment.', {
    body: requestBody({ type: 'object', additionalProperties: true }, 'An empty JSON object is accepted.', false),
    maintenanceExempt: true,
    dataSchema: { type: 'object', properties: { ready: { type: 'boolean' } } },
  }],
  ['get', '/docs', 'Documentation', 'Open Swagger UI', 'Serves the interactive Swagger UI for this environment.', { public: true }],
  ['get', '/docs/openapi.json', 'Documentation', 'Get OpenAPI document', 'Returns the generated OpenAPI 3.0 specification as JSON.', { public: true }],

  ['get', '/requests', 'Requests', 'List credit requests', 'Returns a paginated, filterable list of credit requests visible to the authenticated user.', {
    dataSchema: { $ref: '#/components/schemas/PaginatedRecords' },
    query: [
      ['page', 'integer', 'Page number (1-based).'],
      ['pageSize', 'integer', 'Maximum 100 records per page; defaults to 25.'],
      ['search', 'string', 'Free-text request search.'],
      ['sort', 'string', 'Sort field: NO, CUSTOMER_NAME_TH, CUSTOMER_NAME_ENG, CUSTOMER_SALES_GROUP, CRM_NO, SUBJECT, SOLD_TO, SEARCH_TERM, REQUESTED_LIMIT, APPROVED_LIMIT, or UPDATED_DATE.'],
      ['dir', 'string', 'Sort direction: asc or desc.'],
      ['NO', 'string', 'Request number filter.'],
      ['CUSTOMER_NAME_TH', 'string', 'Thai customer name filter.'],
      ['CUSTOMER_NAME_ENG', 'string', 'English customer name filter.'],
      ['CUSTOMER_SALES_GROUP', 'string', 'Requested sales group filter.'],
      ['CRM_NO', 'string', 'CRM number filter.'],
      ['SUBJECT', 'string', 'Request subject filter.'],
      ['SOLD_TO', 'string', 'Sold-to customer filter.'],
      ['CUSTOMER_TAX_NO', 'string', 'Customer tax number filter.'],
      ['SEARCH_TERM', 'string', 'Search term filter.'],
      ['SAP_STATUS', 'string', 'Salesforce/SAP status filter.'],
      ['REQUESTED_RATING', 'string', 'Requested rating filter.'],
      ['REQUESTED_TERM', 'string', 'Requested credit term filter.'],
      ['APPROVED_RATING', 'string', 'Approved rating filter.'],
      ['APPROVED_TERM', 'string', 'Approved credit term filter.'],
      ['REQUESTED_LIMIT', 'string', 'Requested limit amount filter.'],
      ['APPROVED_LIMIT', 'string', 'Approved limit amount filter.'],
      ['STATUS', 'string', 'Request workflow status filter.'],
      ['TAKE_NOTES', 'string', 'Filter by whether notes exist: Yes or No.'],
      ['CREDIT_ADJUSTMENT', 'string', 'Filter by credit adjustment type.'],
      ['EFFECTIVE_DATE', 'string', 'Filter by effective date text.'],
      ['EXPIRY_DATE', 'string', 'Filter by expiry date text.'],
      ['quickFilter', { type: 'array', items: { type: 'string', enum: ['rating', 'limit', 'term'] } }, 'Request quick filter; may be supplied more than once.'],
      ['relatedCustomerNo', 'string', 'Filter by a related customer number.'],
      ['relatedTaxId', 'string', 'Filter by a related customer tax ID.'],
    ],
  }],
  ['get', '/requests/statuses', 'Requests', 'List request statuses', 'Returns enabled request status options.', { dataSchema: { type: 'array', items: { $ref: '#/components/schemas/MetadataOption' } } }],
  ['get', '/requests/log-types', 'Requests', 'List event log types', 'Returns enabled request event log type options.', { dataSchema: { type: 'array', items: { $ref: '#/components/schemas/MetadataOption' } } }],
  ['get', '/requests/ratings', 'Requests', 'List ratings', 'Returns enabled request rating options.', { dataSchema: { type: 'array', items: { $ref: '#/components/schemas/MetadataOption' } } }],
  ['get', '/requests/terms', 'Requests', 'List credit terms', 'Returns configured credit term options with their numeric exposure values.', { dataSchema: { type: 'array', items: { $ref: '#/components/schemas/TermOption' } } }],
  ['get', '/requests/event-logs', 'Event Logs', 'List all event logs', 'Lists enabled events including authenticated /auth/me profile loads and Administration changes, with or without an eCredit request. Returns raw LOGS fields ID, NAME, CATEGORY alongside existing display fields. Excludes method-named routine GET, HEAD, and OPTIONS events except /auth/me; application diagnostics may still appear. LOGS retention permanently deletes records older than 90 days after startup and hourly. Unlinked request identifiers are empty strings. Access requires System Admin or Super User.', {
    dataSchema: { $ref: '#/components/schemas/PaginatedRecords' },
    query: [
      ['page', 'integer', 'Page number (1-based).'],
      ['pageSize', 'integer', 'Maximum 100 records per page; defaults to 25.'],
      ['ID', 'string', 'Raw LOGS.ID filter.'],
      ['NAME', 'string', 'Raw LOGS.NAME filter.'],
      ['CATEGORY', 'string', 'Raw LOGS.CATEGORY filter.'],
      ['NO', 'string', 'Request number filter.'],
      ['CRM_NO', 'string', 'CRM number filter.'],
      ['SOLD_TO', 'string', 'Sold-to customer filter.'],
      ['CUSTOMER_TAX_NO', 'string', 'Customer tax number filter.'],
      ['name', 'string', 'Event action name filter.'],
      ['logTypeId', 'string', 'Event result/status filter.'],
      ['createdDate', 'string', 'Event creation date filter.'],
      ['actor', 'string', 'Updater filter.'],
      ['sort', 'string', 'Sort field.'],
      ['dir', 'string', 'Sort direction: asc or desc.'],
    ],
  }],
  ['get', '/requests/event-logs/{logId}', 'Event Logs', 'Get event log details', 'Returns one event log record by log ID.', { notFound: true }],
  ['get', '/requests/email-logs', 'Email Logs', 'List all email logs', 'Lists email logs across active requests for System Admin and Super User roles. Returns summaries, not stored send parameters.', {
    dataSchema: { $ref: '#/components/schemas/PaginatedRecords' },
    query: [
      ['page', 'integer', 'Page number (1-based).'],
      ['pageSize', 'integer', 'Page size; maximum 100.'],
      ['sort', 'string', 'Sort field.'],
      ['dir', 'string', 'Sort direction: asc or desc.'],
      ['NO', 'string', 'Filter by request number (maximum 100 characters).'],
      ['CRM_NO', 'string', 'Filter by CRM number (maximum 100 characters).'],
      ['SOLD_TO', 'string', 'Filter by Sold-to customer (maximum 100 characters).'],
      ['CUSTOMER_TAX_NO', 'string', 'Filter by customer tax number (maximum 100 characters).'],
      ['name', 'string', 'Filter by request/customer name (maximum 100 characters).'],
      ['logTypeId', 'string', 'Filter by email status: Success/Sent, Error/Failed, or Pending/Warning.'],
      ['createdDate', 'string', 'Filter by email log date.'],
      ['actor', 'string', 'Filter by updater, including System (Auto Reminder).'],
    ],
    forbidden: true,
  }],
  ['get', '/requests/{requestId}/event-logs', 'Event Logs', 'List request event logs', 'Lists event log records for a single request.', {
    dataSchema: { $ref: '#/components/schemas/PaginatedRecords' },
    query: [
      ['page', 'integer', 'Page number (1-based).'],
      ['pageSize', 'integer', 'Maximum 100 records per page; defaults to 20.'],
      ['logTypeId', 'string', 'Filter by event log type ID.'],
      ['search', 'string', 'Search action, category, description, updater, or log type (maximum 100 characters).'],
    ],
    badRequest: true,
    notFound: true,
  }],
  ['get', '/requests/{requestId}/event-logs/{logId}', 'Event Logs', 'Get request event log', 'Returns one event log record belonging to the specified request.', { notFound: true }],
  ['get', '/requests/{requestId}/emails', 'Email Logs', 'List request email logs', 'Lists email log summaries for a single request.', {
    dataSchema: { $ref: '#/components/schemas/PaginatedRecords' },
    query: [
      ['page', 'integer', 'Page number (1-based); defaults to 1.'],
      ['pageSize', 'integer', 'Page size from 1 to 100; defaults to 20.'],
      ['status', 'string', 'Filter by email status: SUCCESS/SENT, ERROR/FAILED, or PENDING.'],
      ['search', 'string', 'Search email action/category (maximum 100 characters).'],
    ],
    notFound: true,
  }],
  ['get', '/requests/{requestId}/emails/{emailId}', 'Email Logs', 'Get request email details', 'Returns the selected email log payload for inspection before a resend.', { notFound: true }],
  ['post', '/requests/{requestId}/emails/resend', 'Email Logs', 'Resend selected emails', 'Resends selected email logs to their original recipients using current request data and the active environment delivery rules.', {
    body: requestBody({ $ref: '#/components/schemas/EmailResendRequest' }, 'Email log IDs to resend.'),
    notFound: true,
    forbidden: true,
  }],
  ['get', '/requests/{requestId}/approval-history', 'Approval Workflow', 'List approval history', 'Returns approval movements for a request. Disabled approvals are included only when requested by a System Admin.', {
    query: [['includeDisabledApprovals', 'boolean', 'When true, System Admins may include disabled approval records.']],
    notFound: true,
  }],
  ['get', '/requests/{requestId}/approval-submit-options', 'Approval Workflow', 'Get submit options', 'Returns the available submission/approval options for the request’s current workflow state.', { notFound: true }],
  ['get', '/requests/{requestId}/attachments', 'Attachments', 'List request attachments', 'Returns attachment metadata for a request.', { notFound: true }],
  ['post', '/requests/{requestId}/attachments', 'Attachments', 'Upload request attachments', 'Uploads one or more files using multipart/form-data. Each file must be 10 MB or smaller; use the files field.', {
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['files'],
            properties: {
              files: {
                type: 'array',
                items: { type: 'string', format: 'binary' },
                description: 'One or more attachments; maximum 10 MB per file.',
              },
            },
          },
        },
      },
    },
    status: 201,
    badRequest: true,
    notFound: true,
  }],
  ['get', '/requests/{requestId}/attachments/{attachmentId}/download', 'Attachments', 'Download attachment', 'Downloads the requested attachment as a binary file.', { notFound: true, binary: true }],
  ['delete', '/requests/{requestId}/attachments/{attachmentId}', 'Attachments', 'Delete attachment', 'Soft-deletes an attachment from the request.', { notFound: true }],
  ['get', '/requests/{id}', 'Requests', 'Get request details', 'Returns the request record and its detail data.', { notFound: true }],
  ['post', '/requests/{id}/customer-info-suggestions', 'Company Information', 'Suggest request customer information', 'Looks up public company information by a 13-digit Thai tax ID for a draft request. Available to request participants and System Admins; suggestions include source links and are not saved automatically.', {
    body: requestBody({ $ref: '#/components/schemas/RequestCompanyInfoLookupRequest' }, 'Tax ID to search.'),
    dataSchema: { $ref: '#/components/schemas/CompanyInfoSuggestions' },
    badRequest: true,
    forbidden: true,
    notFound: true,
    rateLimited: true,
  }],
  ['post', '/requests/{id}/test-email', 'Requests', 'Send test email', 'Sends a test email for the request to the supplied recipients.', {
    body: requestBody({ $ref: '#/components/schemas/TestEmailRequest' }, 'To and CC recipient lists.'),
    badRequest: true,
    notFound: true,
  }],
  ['patch', '/requests/{id}/customer-info', 'Requests', 'Update request customer information', 'Updates the request customer fields. CUSTOMER_TAX_NO is required; registered capital must be a whole-number string and determines CUSTOMER_SIZE_ID on the server.', { body: requestBody({ $ref: '#/components/schemas/RequestCustomerInfoUpdate' }, 'Customer information fields to update.'), badRequest: true, notFound: true }],
  ['patch', '/requests/{id}/credit-suggestion', 'Requests', 'Update credit suggestion', 'Updates proposed credit, adjustment, and Additional Conditions fields. Supply at least one field. Permanent adjustments require PROPOSED_VALID_FROM; temporary adjustments require both dates.', { body: requestBody({ $ref: '#/components/schemas/CreditSuggestionUpdate' }, 'Credit suggestion fields to update.'), badRequest: true, notFound: true }],
  ['patch', '/requests/{id}/scoring-payment', 'Requests', 'Update scoring and payment', 'Updates scoring and payment behavior. Supply at least one field. The scoring rating is derived from the score values, except for the Other and N/A categories.', { body: requestBody({ $ref: '#/components/schemas/ScoringAndPaymentUpdate' }, 'Scoring and payment fields to update.'), badRequest: true, notFound: true }],
  ['patch', '/requests/{id}/requested-details', 'Requests', 'Update requested details', 'Updates request details. IS_TERM_REQUESTED and IS_LIMIT_REQUESTED are required; amounts must be non-negative.', { body: requestBody({ $ref: '#/components/schemas/RequestedDetailsUpdate' }, 'Requested detail fields to update.'), badRequest: true, notFound: true }],
  ['patch', '/requests/{id}/final-approval', 'Approval Workflow', 'Save final approval', 'Saves Final Review fields and the approved-condition snapshot without rewriting earlier approval history. Only a BDS Review approver or System Admin can save.', { body: requestBody({ $ref: '#/components/schemas/FinalApprovalUpdate' }, 'Final approval fields to save.'), badRequest: true, forbidden: true, notFound: true }],
  ['post', '/requests/{id}/clone-data', 'Requests', 'Clone request data', 'Copies customer, scoring, payment and note fields, plus financial-analysis attachments, from a source request. The target must not be cancelled or completed.', { body: requestBody({ $ref: '#/components/schemas/CloneRequestData' }, 'Source request ID.'), badRequest: true, conflict: true, notFound: true }],
  ['patch', '/requests/{id}/cancel', 'Requests', 'Cancel request', 'Cancels the request with the supplied cancellation notes.', {
    body: requestBody({ $ref: '#/components/schemas/CancelRequest' }, 'Required cancellation reason.'),
    badRequest: true,
    notFound: true,
  }],
  ['patch', '/requests/{id}/status', 'Approval Workflow', 'Change request status', 'Changes request status. System Admin only. A non-empty reason of at most 2,000 characters is required. Salesforce sync is available only for Cancelled, Completed, or Rejected statuses.', {
    body: requestBody({ $ref: '#/components/schemas/RequestStatusChange' }, 'Status and workflow update options.'),
    badRequest: true,
    forbidden: true,
    notFound: true,
  }],
  ['post', '/requests/{id}/approval-action', 'Approval Workflow', 'Process approval action', 'Processes a save, approve, reject, backward, finalConfirm, or finalCancel action. APPROVAL_ID is required for save, approve, reject, and backward; the remaining fields depend on the action and current workflow state.', {
    body: requestBody({ $ref: '#/components/schemas/ApprovalAction' }, 'Workflow action and action-specific approval data.'),
    badRequest: true,
    forbidden: true,
    notFound: true,
  }],
  ['post', '/requests/{id}/submit', 'Approval Workflow', 'Submit request', 'Submits the request into its configured approval workflow and attempts CRM status synchronization.', {
    body: requestBody({ $ref: '#/components/schemas/ApprovalSubmitCommand' }, 'Request form and approval routing information.'),
    badRequest: true,
    conflict: true,
    forbidden: true,
    notFound: true,
  }],

  ['get', '/customers', 'Customers', 'List customers', 'Returns a paginated, filterable customer list.', {
    dataSchema: { $ref: '#/components/schemas/PaginatedRecords' },
    query: [
      ['page', 'integer', 'Page number (1-based).'],
      ['pageSize', 'integer', 'Maximum 100 records per page; defaults to 25.'],
      ['sort', 'string', 'Sort field: TAX_NO, REGISTERED_DATE, REGISTERED_CAPITAL_AMOUNT, BUSINESS_TYPE, or UPDATED_DATE.'],
      ['dir', 'string', 'Sort direction: asc or desc.'],
      ['TAX_NO', 'string', 'Tax ID filter.'],
      ['CUSTOMER_NAME', 'string', 'Customer name filter.'],
      ['BUSINESS_TYPE', 'string', 'Business type filter.'],
      ['CUSTOMER_TYPE', 'string', 'Customer type filter.'],
      ['DIRECTORS', 'string', 'Directors filter.'],
      ['SHAREHOLDERS', 'string', 'Shareholders filter.'],
      ['SIZE', 'string', 'Customer size filter.'],
      ['REGISTERED_CAPITAL_AMOUNT', 'number', 'Registered capital amount filter.'],
      ['REGISTERED_DATE', 'string', 'Registered date filter (YYYY-MM-DD).'],
      ['UPDATED_DATE', 'string', 'Updated date filter (YYYY-MM-DD).'],
      ['UPDATED_BY', 'string', 'Updater filter.'],
      ['quickFilter', { type: 'array', items: { type: 'string', enum: ['S', 'M', 'L'] } }, 'Customer size shortcut; may be supplied more than once.'],
    ],
  }],
  ['get', '/customers/sizes', 'Customers', 'List customer sizes', 'Returns enabled customer size options.', { dataSchema: { type: 'array', items: { $ref: '#/components/schemas/MetadataOption' } } }],
  ['get', '/customers/sold-to', 'Customers', 'Search Sold-to customers', 'Searches CRM Sold-to customer options. Both search and salesGroup are required; search text must contain 2 to 100 characters and the sales group must be 100, 200, 300, or 999.', {
    dataSchema: { type: 'array', items: { $ref: '#/components/schemas/SoldToCustomerOption' } },
    query: [
      ['search', { type: 'string', minLength: 2, maxLength: 100 }, 'Customer search text.'],
      ['salesGroup', { type: 'string', enum: ['100', '200', '300', '999'] }, 'Sales group code.'],
    ],
    requiredQuery: ['search', 'salesGroup'],
    badRequest: true,
  }],
  ['get', '/customers/tax-no-exists', 'Customers', 'Check customer tax number', 'Checks whether a customer tax number already exists.', {
    dataSchema: { type: 'boolean' },
    query: [['taxNo', { type: 'string', pattern: '^\\d{13}$' }, '13-digit Thai tax number to check.']],
    requiredQuery: ['taxNo'],
    badRequest: true,
  }],
  ['post', '/customers/company-info-suggestions', 'Company Information', 'Suggest customer company information', 'Looks up public company information by a 13-digit Thai tax ID. Suggestions are for review and are not saved automatically. An optional customerId records the lookup against an active customer.', {
    body: requestBody({ $ref: '#/components/schemas/CustomerCompanyInfoLookupRequest' }, 'Tax ID and optional customer ID.'),
    dataSchema: { $ref: '#/components/schemas/CompanyInfoSuggestions' },
    badRequest: true,
    forbidden: true,
    rateLimited: true,
  }],
  ['post', '/customers', 'Customers', 'Create customer', 'Creates a customer record. TAX_NO is required and must be unique. Customer management is restricted by customer-access permissions.', {
    body: requestBody({ $ref: '#/components/schemas/CustomerCreateRequest' }, 'Customer fields.'),
    status: 201,
    badRequest: true,
    forbidden: true,
    conflict: true,
  }],
  ['get', '/customers/{id}/customer-logs', 'Customers', 'List customer logs', 'Lists audit and company-information lookup logs for the customer.', { notFound: true }],
  ['get', '/customers/{id}/customer-logs/{logId}', 'Customers', 'Get customer log', 'Returns one customer log record.', { notFound: true }],
  ['get', '/customers/{id}', 'Customers', 'Get customer details', 'Returns customer details.', { notFound: true }],
  ['patch', '/customers/{id}', 'Customers', 'Update customer', 'Updates customer details. Customer size is recalculated from registered capital where applicable.', {
    body: requestBody({ $ref: '#/components/schemas/CustomerUpdate' }, 'Customer fields to update.'),
    badRequest: true,
    forbidden: true,
    notFound: true,
  }],
  ['delete', '/customers/{id}', 'Customers', 'Delete customer', 'Soft-deletes a customer. An optional DESCRIPTION may be supplied as the deletion reason.', {
    body: requestBody({ type: 'object', properties: { DESCRIPTION: { type: 'string', description: 'Optional deletion reason.' } } }, 'Optional deletion reason.', false),
    forbidden: true,
    notFound: true,
  }],

  ['get', '/permissions/me', 'Permissions', 'Get effective permissions', 'Returns the full permission catalog and the authenticated user’s effective GRANTED state.', { maintenanceExempt: true, dataSchema: { $ref: '#/components/schemas/EffectivePermissions' } }],
  ['put', '/permissions/me', 'Permissions', 'Update role permissions', 'Applies permission selections to matching role-permission records. System Admin or Super User only.', {
    body: requestBody({ $ref: '#/components/schemas/PermissionUpdate' }, 'Non-empty set of permission selections.'),
    badRequest: true,
    forbidden: true,
  }],
  ['get', '/users', 'Users', 'List users', 'Lists e-Credit users. System Admin or Super User only.', {
    dataSchema: { $ref: '#/components/schemas/PaginatedRecords' },
    query: [
      ['page', 'integer', 'Page number (1-based).'],
      ['pageSize', 'integer', 'Maximum 100 records per page; defaults to 25.'],
      ['sort', 'string', 'Sort field: CODE, NAME, USER, EMAIL, COST_CENTER_DESC, BU, DEPARTMENT, MANAGER_1, MANAGER_2, UPDATED_DATE, UPDATED_BY, or SYSTEM_ACTIVE.'],
      ['dir', 'string', 'Sort direction: asc or desc.'],
      ['CODE', 'string', 'Employee code filter.'],
      ['NAME', 'string', 'Employee name filter.'],
      ['USER', 'string', 'Username filter.'],
      ['EMAIL', 'string', 'Email filter.'],
      ['MANAGER_1', 'string', 'First manager filter.'],
      ['MANAGER_2', 'string', 'Second manager filter.'],
      ['UPDATED_BY', 'string', 'Updater filter.'],
      ['UPDATED_DATE', 'string', 'Updated date filter (YYYY-MM-DD).'],
      ['PRESENCE_STATUS', { type: 'string', enum: ['ACTIVE', 'AWAY', 'OFFLINE'] }, 'Presence state filter.'],
    ],
  }],
  ['get', '/users/employee-options', 'Users', 'List employee options', 'Lists employee options for user administration. System Admin or Super User only.', { query: [['search', 'string', 'Optional employee name or email search.']] }],
  ['get', '/users/roles', 'Users', 'List role options', 'Lists available e-Credit roles. System Admin or Super User only.'],
  ['get', '/users/permission-options', 'Users', 'List permission options', 'Lists permission options available for user administration. System Admin or Super User only.'],
  ['post', '/users', 'Users', 'Create user', 'Creates an e-Credit user profile. System Admin or Super User only.', { body: requestBody({ $ref: '#/components/schemas/UserCreateRequest' }, 'Employee, roles, permissions, and enabled state.'), status: 201, badRequest: true, forbidden: true }],
  ['get', '/users/{code}', 'Users', 'Get user details', 'Returns a user profile by employee code. System Admin or Super User only.', { forbidden: true, notFound: true }],
  ['get', '/users/{code}/permissions', 'Users', 'Get user permissions', 'Returns the user’s permission assignments. System Admin or Super User only.', { forbidden: true, notFound: true }],
  ['put', '/users/{code}/permissions', 'Users', 'Update user permissions', 'Replaces the specified user’s permission assignments. System Admin or Super User only.', { body: requestBody({ $ref: '#/components/schemas/PermissionUpdate' }, 'Non-empty permission selections.'), badRequest: true, forbidden: true, notFound: true }],
  ['put', '/users/{code}/access', 'Users', 'Update user access', 'Updates the user’s roles, permission assignments, and enabled state. System Admin or Super User only; an administrator cannot deactivate their own account.', { body: requestBody({ $ref: '#/components/schemas/UserAccessUpdate' }, 'Role IDs, permission IDs, and enabled state.'), badRequest: true, forbidden: true, notFound: true }],
  ['patch', '/users/{code}/system-active', 'Users', 'Set user active state', 'Updates whether a user account is active. System Admin or Super User only; administrators cannot deactivate their own account.', { body: requestBody({ type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } }, 'User active state.'), badRequest: true, forbidden: true, notFound: true }],
  ['put', '/users/{code}/view-as', 'Users', 'Set View As user', 'Sets the administrator’s effective user context for authorized troubleshooting. The target employee code is supplied in the path. System Admin or Super User only.', { forbidden: true, notFound: true }],
  ['delete', '/users/view-as', 'Users', 'Clear View As user', 'Clears the current View As context. System Admin or Super User only.', { forbidden: true }],

  ['get', '/approvers', 'Approvers', 'List approvers', 'Returns a paginated, filterable list of configured approvers. System Admin or Super User only.', {
    dataSchema: { $ref: '#/components/schemas/PaginatedRecords' },
    query: [
      ['page', 'integer', 'Page number (1-based).'],
      ['pageSize', 'integer', 'Page size; maximum 100.'],
      ['sort', 'string', 'Sort field: CODE, NAME, APPROVER_TYPE, DESCRIPTION, EMAIL, PRIMARY, UPDATED_DATE, or ACTIVE.'],
      ['dir', 'string', 'Sort direction: asc or desc.'],
      ['CODE', 'string', 'Filter by approver code.'],
      ['DESCRIPTION', 'string', 'Filter by description.'],
      ['UPDATED_BY', 'string', 'Filter by updater.'],
      ['UPDATED_DATE', 'string', 'Filter by update date (YYYY-MM-DD).'],
      ['ACTIVE', 'string', 'Filter by active/inactive state.'],
      ['PRIMARY', 'string', 'Filter by primary state.'],
      ['NAME', 'string', 'Filter by employee name.'],
      ['EMAIL', 'string', 'Filter by email.'],
      ['APPROVER_TYPE', 'string', 'Filter by approver type.'],
    ],
    forbidden: true,
  }],
  ['get', '/approvers/employees', 'Approvers', 'List approver employees', 'Searches employee options for approver assignment. System Admin or Super User only.', { query: [['search', 'string', 'Employee name or email search.']], forbidden: true }],
  ['get', '/approvers/types', 'Approvers', 'List approver types', 'Returns available approver types. System Admin or Super User only.', { forbidden: true }],
  ['get', '/approvers/{id}', 'Approvers', 'Get approver', 'Returns approver details by ID. System Admin or Super User only.', { forbidden: true, notFound: true }],
  ['post', '/approvers', 'Approvers', 'Create approver', 'Creates an approver configuration. System Admin or Super User only.', { body: requestBody({ $ref: '#/components/schemas/ApproverWriteRequest' }, 'Approver configuration fields.'), badRequest: true, forbidden: true }],
  ['patch', '/approvers/{id}', 'Approvers', 'Update approver', 'Updates an approver configuration. System Admin or Super User only.', { body: requestBody({ $ref: '#/components/schemas/ApproverWriteRequest' }, 'Approver fields to save.'), badRequest: true, forbidden: true, notFound: true }],
  ['patch', '/approvers/{id}/active', 'Approvers', 'Set approver active state', 'Enables or disables an approver. System Admin or Super User only.', { body: requestBody({ type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } }, 'Approver enabled state.'), badRequest: true, forbidden: true, notFound: true }],
  ['patch', '/approvers/{id}/primary', 'Approvers', 'Set primary approver state', 'Marks or unmarks an approver as primary. Only active approvers can be primary; System Admin or Super User only.', { body: requestBody({ type: 'object', properties: { primary: { type: 'boolean', default: true } } }, 'Primary state; omitted primary defaults to true.', false), badRequest: true, forbidden: true, notFound: true }],
  ['delete', '/approvers/{id}', 'Approvers', 'Delete approver', 'Soft-deletes an approver configuration. System Admin or Super User only.', { forbidden: true, notFound: true }],

  ['get', '/email-approval/{token}', 'Email Approval', 'Get email approval action', 'Returns the action and request summary associated with an email approval token. The token is the authorization credential; a valid bearer token is optional.', { optionalAuth: true, notFound: true }],
  ['post', '/email-approval/{token}/confirm', 'Email Approval', 'Confirm email approval action', 'Confirms the action associated with an email approval token. The token is the authorization credential; a valid bearer token is optional.', {
    optionalAuth: true,
    body: requestBody({ type: 'object', properties: { comment: { type: 'string', description: 'Optional approver comment.' } } }, 'Optional approval comment.', false),
    badRequest: true,
    notFound: true,
  }],
  ['get', '/notifications', 'Notifications', 'List notifications', 'Returns the authenticated user’s notification page and unread count.', {
    dataSchema: { $ref: '#/components/schemas/NotificationPage' },
    query: [
      ['limit', 'integer', 'Page size from 1 to 100; defaults to 20.'],
      ['offset', 'integer', 'Zero-based offset; defaults to 0.'],
    ],
  }],
  ['get', '/notifications/unread-count', 'Notifications', 'Get unread notification count', 'Returns the authenticated user’s unread notification count.', { dataSchema: { type: 'object', required: ['unreadCount'], properties: { unreadCount: { type: 'integer', minimum: 0 } } } }],
  ['patch', '/notifications/read-all', 'Notifications', 'Mark all notifications read', 'Marks the authenticated user’s notifications as read.'],
  ['patch', '/notifications/{id}/read', 'Notifications', 'Mark notification read', 'Marks one notification as read for the authenticated user.', { notFound: true }],
  ['patch', '/notifications/{id}/unread', 'Notifications', 'Mark notification unread', 'Marks one notification as unread for the authenticated user.', { notFound: true }],
  ['get', '/email-reminders', 'Email Reminders', 'List email reminder settings', 'Lists the four workflow reminder templates and their enabled interval settings. System Admin or Super User only.', { forbidden: true, dataSchema: { type: 'array', items: { $ref: '#/components/schemas/EmailReminderSetting' } } }],
  ['post', '/email-reminders/{template}/preview', 'Email Reminders', 'Preview reminder emails', 'Previews the reminder requests for one of the configured workflow templates without sending email. System Admin or Super User only.', {
    pathSchemas: { template: { type: 'string', enum: ['request-approval', 'request-backward', 'request-draft', 'request-final'] } },
    body: requestBody({ $ref: '#/components/schemas/EmailReminderSettings' }, 'Interval settings to preview.'),
    badRequest: true,
    forbidden: true,
  }],
  ['patch', '/email-reminders/{template}', 'Email Reminders', 'Update email reminder settings', 'Updates one workflow reminder template. Intervals must be whole numbers from 1 to 365 minutes, hours, or days. System Admin or Super User only.', {
    pathSchemas: { template: { type: 'string', enum: ['request-approval', 'request-backward', 'request-draft', 'request-final'] } },
    body: requestBody({ $ref: '#/components/schemas/EmailReminderSettings' }, 'Reminder interval and enabled state.'),
    badRequest: true,
    forbidden: true,
  }],
  ['get', '/maintenance', 'System Maintenance', 'Get maintenance state', 'Returns the maintenance schedule and server clock. Anonymous callers are supported; System Admins are identified when an authorization token is supplied.', { optionalAuth: true, public: true, maintenanceExempt: true, dataSchema: { $ref: '#/components/schemas/MaintenanceState' } }],
  ['put', '/maintenance', 'System Maintenance', 'Update maintenance schedule', 'Creates or updates the maintenance announcement and UTC schedule. System Admin only. When enabled, a message and both timestamps are required, and endsAt must be later than startsAt.', {
    body: requestBody({ $ref: '#/components/schemas/MaintenanceUpdate' }, 'Maintenance schedule and announcement.'),
    badRequest: true,
    forbidden: true,
    maintenanceExempt: true,
    dataSchema: { $ref: '#/components/schemas/MaintenanceState' },
  }],
];

function addEndpoint([method, path, tag, summary, description, options = {}]) {
  const operationId = `${method}_${path}`
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, character) => character.toUpperCase());
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => pathParameter(
    match[1],
    options.pathSchemas?.[match[1]] || { type: 'string' },
  ));
  for (const [name, type, parameterDescription] of options.query || []) {
    parameters.push({
      name,
      in: 'query',
      required: options.requiredQuery?.includes(name) || false,
      description: parameterDescription,
      schema: typeof type === 'object' ? type : { type },
    });
  }

  const responses = {
    200: options.binary
      ? {
        description: 'Attachment contents.',
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      }
      : response(
        'Request completed successfully.',
        options.dataSchema ? successResponseSchema(options.dataSchema) : undefined,
      ),
    400: options.badRequest || options.body ? { $ref: '#/components/responses/BadRequestError' } : undefined,
    401: options.public || options.optionalAuth ? undefined : { $ref: '#/components/responses/UnauthorizedError' },
    403: options.forbidden || !options.public ? { $ref: '#/components/responses/ForbiddenError' } : undefined,
    404: options.notFound ? { $ref: '#/components/responses/NotFoundError' } : undefined,
    409: options.conflict ? { $ref: '#/components/responses/ConflictError' } : undefined,
    429: options.rateLimited ? { $ref: '#/components/responses/RateLimitError' } : undefined,
    500: { $ref: '#/components/responses/InternalServerError' },
    503: options.maintenanceExempt ? undefined : { $ref: '#/components/responses/ServiceUnavailableError' },
  };
  if (options.status === 201) {
    responses[201] = response(
      'Resource created.',
      options.dataSchema ? successResponseSchema(options.dataSchema) : undefined,
    );
    delete responses[200];
  } else if (options.status === 204) {
    responses[204] = { description: 'Presence state recorded; no response body.' };
    delete responses[200];
  }
  Object.keys(responses).forEach((status) => {
    if (responses[status] === undefined) delete responses[status];
  });

  paths[path] = paths[path] || {};
  paths[path][method] = {
    tags: [tag],
    summary,
    description,
    operationId,
    ...(options.optionalAuth
      ? { security: [{ bearerAuth: [] }, {}] }
      : options.public
        ? {}
        : { security: [{ bearerAuth: [] }] }),
    ...(parameters.length ? { parameters } : {}),
    ...(options.body ? { requestBody: options.body } : {}),
    responses,
  };
}

endpoints.forEach(addEndpoint);

/**
 * Swagger/OpenAPI Configuration Module
 * Generates OpenAPI 3.x specification for all endpoints
 * - Single-tenant MSAL bearer token authentication
 * - Environment-aware server definitions
 * - No secrets exposed in documentation
 */

/**
 * Base Swagger definition options
 */
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: config.swagger.title,
      description:
        `${config.swagger.description}\n\n` +
        'All API routes are served under the active environment prefix (for example, /dev/api). ' +
        'Protected operations require a Microsoft Entra ID bearer access token with the configured API scope. ' +
        'Successful JSON responses use a success/data envelope; errors use success:false with an error code, ' +
        'message, and correlationId. Active system maintenance may block non-exempt routes with HTTP 503. HTTPS is required.',
      version: config.swagger.version,
      contact: {
        name: 'e-Credit Support',
      },
    },
    servers: [
      {
        url: `${config.appBaseUrl}/${config.environment}/api`,
        description: `${config.environment.toUpperCase()} Environment`,
        variables: {
          protocol: {
            default: 'https',
            enum: ['https'],
          },
        },
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Microsoft Entra ID access token issued for the e-Credit Express API. ' +
            `Token must be requested with scope: ${config.msal.apiScope}`,
        },
      },
      responses: {
        BadRequestError: {
          description: 'Invalid request data or business-rule validation failure',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        ConflictError: {
          description: 'The operation conflicts with the current resource state',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        UnauthorizedError: {
          description: 'Missing or invalid authentication token',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        ForbiddenError: {
          description: 'Insufficient permissions for this resource',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse',
              },
            },
          },
        },
        RateLimitError: {
          description: 'Too many requests; wait before retrying',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        ServiceUnavailableError: {
          description: 'Service unavailable, including active system maintenance',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
      schemas: {
        ApiInfo: {
          type: 'object',
          required: ['apiName', 'environment', 'version', 'status', 'timestamp'],
          properties: {
            apiName: { type: 'string', example: 'e-Credit Express API' },
            environment: { type: 'string', enum: ['dev', 'qas', 'prd'] },
            version: { type: 'string' },
            status: { type: 'string', enum: ['operational'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        HealthData: {
          type: 'object',
          required: ['status', 'timestamp'],
          properties: {
            status: { type: 'string', example: 'live' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        SessionPing: {
          type: 'object',
          required: ['message', 'timestamp'],
          properties: {
            message: { type: 'string', enum: ['pong'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        MetadataOption: {
          type: 'object',
          required: ['id', 'label'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
          },
        },
        TermOption: {
          type: 'object',
          required: ['id', 'label', 'exposure'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            exposure: { type: 'number', nullable: true, description: 'Numeric TERMS.EXPOSURE value.' },
          },
        },
        SoldToCustomerOption: {
          type: 'object',
          required: ['SOLDTO_NO', 'SOLDTO_NAME_ENG', 'CUST_PHONE', 'CUST_FAX', 'ADDRESS_ENG_SOLDTO', 'TAX_NO'],
          properties: {
            SOLDTO_NO: { type: 'string' },
            SOLDTO_NAME_ENG: { type: 'string' },
            SOLDTO_NAME_TH: { type: 'string', nullable: true },
            COMPANY_CODE: { type: 'string', nullable: true },
            CUST_PHONE: { type: 'string' },
            CUST_FAX: { type: 'string' },
            ADDRESS_ENG_SOLDTO: { type: 'string' },
            TAX_NO: { type: 'string' },
          },
        },
        PaginatedRecords: {
          type: 'object',
          required: ['items', 'pagination'],
          properties: {
            items: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pagination: {
              type: 'object',
              required: ['page', 'pageSize', 'totalItems', 'totalPages'],
              properties: {
                page: { type: 'integer', minimum: 1 },
                pageSize: { type: 'integer', minimum: 1, maximum: 100 },
                totalItems: { type: 'integer', minimum: 0 },
                totalPages: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
        EffectivePermissions: {
          type: 'object',
          required: ['permissions'],
          properties: {
            permissions: {
              type: 'array',
              items: { $ref: '#/components/schemas/PermissionSelection' },
            },
          },
        },
        NotificationPage: {
          type: 'object',
          required: ['items', 'unreadCount', 'hasMore'],
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
            unreadCount: { type: 'integer', minimum: 0 },
            hasMore: { type: 'boolean' },
          },
        },
        Notification: {
          type: 'object',
          required: ['id', 'requestId', 'requestNo', 'eventType', 'recipientType', 'tab', 'title', 'message', 'actorName', 'isRead', 'readDate', 'createdDate'],
          properties: {
            id: { type: 'string' },
            requestId: { type: 'string', nullable: true },
            requestNo: { type: 'string', nullable: true },
            eventType: { type: 'string' },
            recipientType: { type: 'string', enum: ['TO', 'CC'] },
            tab: { type: 'string', enum: ['customers', 'approver', 'credit-request-form'] },
            title: { type: 'string' },
            message: { type: 'string', nullable: true },
            actorName: { type: 'string', nullable: true },
            isRead: { type: 'boolean' },
            readDate: { type: 'string', format: 'date-time', nullable: true },
            createdDate: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        CompanyInfoSuggestions: {
          type: 'object',
          required: ['fields', 'sources'],
          properties: {
            fields: {
              type: 'object',
              required: ['registeredDate', 'registeredCapitalAmount', 'customerTypeExternal', 'officialSignatory', 'majorShareholders'],
              properties: {
                registeredDate: { $ref: '#/components/schemas/CompanyInfoSuggestionField' },
                registeredCapitalAmount: { $ref: '#/components/schemas/CompanyInfoSuggestionField' },
                customerTypeExternal: { $ref: '#/components/schemas/CompanyInfoSuggestionField' },
                officialSignatory: { $ref: '#/components/schemas/CompanyInfoSuggestionField' },
                majorShareholders: { $ref: '#/components/schemas/CompanyInfoSuggestionField' },
              },
            },
            sources: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['title', 'url'],
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string', format: 'uri', description: 'Verifiable HTTPS source actually opened during lookup.' },
                },
              },
            },
          },
        },
        CompanyInfoSuggestionField: {
          type: 'object',
          required: ['value', 'evidence'],
          properties: {
            value: { type: 'string', nullable: true },
            evidence: { type: 'string', nullable: true },
          },
        },
        EmailReminderSetting: {
          type: 'object',
          required: ['id', 'template', 'intervalValue', 'intervalUnit', 'enabled'],
          properties: {
            id: { type: 'string' },
            template: { type: 'string', enum: ['request-approval', 'request-backward', 'request-draft', 'request-final'] },
            intervalValue: { type: 'integer', minimum: 1, maximum: 365 },
            intervalUnit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
            enabled: { type: 'boolean' },
          },
        },
        MaintenanceState: {
          type: 'object',
          required: ['enabled', 'active', 'message', 'startsAt', 'endsAt', 'serverTime', 'canBypass'],
          properties: {
            enabled: { type: 'boolean' },
            active: { type: 'boolean' },
            message: { type: 'string' },
            startsAt: { type: 'string', format: 'date-time', nullable: true },
            endsAt: { type: 'string', format: 'date-time', nullable: true },
            serverTime: { type: 'string', format: 'date-time' },
            canBypass: { type: 'boolean', description: 'Whether the current user has the System Admin maintenance bypass.' },
          },
        },
        SuccessResponse: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: {
              type: 'boolean',
              example: true,
              description: 'Indicates whether the request was successful',
            },
            data: {
              description: 'Endpoint-specific response payload; may be an object, array, scalar, or null.',
              nullable: true,
              example: {},
            },
            correlationId: {
              type: 'string',
              format: 'uuid',
              description: 'Request tracing identifier when provided by the endpoint.',
            },
          },
          example: {
            success: true,
            data: {},
            correlationId: '4a0ce143-ec15-44ad-b409-6f7aef8e7fd1',
          },
        },
        PresenceUpdate: {
          type: 'object',
          required: ['tabId', 'active'],
          properties: {
            tabId: { type: 'string', format: 'uuid', description: 'Stable UUID for the browser tab.' },
            active: { type: 'boolean', description: 'Whether the tab is currently active.' },
          },
        },
        RequestCompanyInfoLookupRequest: {
          type: 'object',
          required: ['taxId'],
          properties: {
            taxId: { type: 'string', pattern: '^\\d{13}$', description: 'Thai taxpayer identification number (exactly 13 digits).' },
          },
        },
        CustomerCompanyInfoLookupRequest: {
          type: 'object',
          required: ['taxId'],
          properties: {
            taxId: { type: 'string', pattern: '^\\d{13}$', description: 'Thai taxpayer identification number (exactly 13 digits).' },
            customerId: { type: 'string', maxLength: 128, description: 'Optional active customer ID for recording the lookup.' },
          },
        },
        TestEmailRequest: {
          type: 'object',
          required: ['to', 'cc'],
          properties: {
            to: { type: 'array', items: { type: 'string', format: 'email' }, description: 'Primary test recipients.' },
            cc: { type: 'array', items: { type: 'string', format: 'email' }, description: 'CC test recipients.' },
          },
        },
        RequestCustomerInfoUpdate: {
          type: 'object',
          required: ['CUSTOMER_TAX_NO'],
          properties: {
            CUSTOMER_TAX_NO: { type: 'string', pattern: '^(\\d{13}|-)$', description: 'Thai tax number or -.' },
            CUSTOMER_REGISTERED_DATE: { type: 'string', format: 'date', nullable: true },
            CUSTOMER_REGISTERED_CAPITAL_AMOUNT: { type: 'string', pattern: '^\\d*$', description: 'Whole-number amount; omitted or empty values become 0.' },
            CUSTOMER_SIZE_ID: { type: 'string', description: 'Derived from registered capital by the backend.' },
            CUSTOMER_BUSINESS_TYPE_INTER: { type: 'string' },
            CUSTOMER_CUSTOMER_TYPE_EXTER: { type: 'string' },
            CUSTOMER_DIRECTORS: { type: 'string' },
            CUSTOMER_SHAREHOLDERS: { type: 'string' },
          },
        },
        CreditSuggestionUpdate: {
          type: 'object',
          minProperties: 1,
          properties: {
            PROPOSED_TERM_ID: { type: 'string', nullable: true },
            PROPOSED_LIMIT_AMOUNT: { type: 'number', minimum: 0, nullable: true },
            PROPOSED_RATING_ID: { type: 'string', nullable: true },
            PROPOSED_DISPLAYED_NOTES: { type: 'string', description: 'Display notes; rich text is limited to 8 MiB.' },
            PROPOSED_NOTES: { type: 'string', description: 'Rich-text notes, limited to 8 MiB.' },
            IS_CLEAR_OUTSTANDING_BALANCE_PROPOSED: { type: 'boolean' },
            IS_WITHIN_APPROVED_LIMIT_PROPOSED: { type: 'boolean' },
            IS_BANK_GUARANTEE_PROPOSED: { type: 'boolean' },
            PROPOSED_BANK_GUARANTEE_AMOUNT: { type: 'number', minimum: 0 },
            IS_CASH_DEPOSIT_PROPOSED: { type: 'boolean' },
            PROPOSED_CASH_DEPOSIT_AMOUNT: { type: 'number', minimum: 0 },
            IS_PERMANENT_PROPOSED: { type: 'boolean' },
            IS_TEMPORARY_PROPOSED: { type: 'boolean' },
            PROPOSED_VALID_FROM: { type: 'string', format: 'date', nullable: true },
            PROPOSED_VALID_TO: { type: 'string', format: 'date', nullable: true },
          },
        },
        ScoringAndPaymentUpdate: {
          type: 'object',
          minProperties: 1,
          properties: {
            SCORING_PROFITABILITY: { type: 'string' },
            SCORING_GROWTH: { type: 'string' },
            SCORING_LIQUIDITY: { type: 'string' },
            SCORING_LEVERAGE: { type: 'string' },
            SCORING_RATING_ID: { type: 'string', description: 'Derived by the backend from score and category fields.' },
            IS_SCORING_GOVERMENT: { type: 'boolean', description: 'Government scoring category.' },
            IS_SCORING_OTHER: { type: 'boolean' },
            SCORING_NOTES: { type: 'string', description: 'Required when Other or N/A is selected.' },
            IS_SCORING_NA: { type: 'boolean' },
            IS_PAY_IN_ADVANCE: { type: 'boolean' },
            IS_PAY_ON_TIME: { type: 'boolean' },
            IS_OVERDUE_LT_10_DAYS: { type: 'boolean' },
            IS_OVERDUE_GT_10_DAYS: { type: 'boolean' },
            IS_OVERDUE_GT_30_DAYS: { type: 'boolean' },
            IS_OVERDUE_GT_60_DAYS: { type: 'boolean' },
            IS_OVERDUE_GT_90_DAYS: { type: 'boolean' },
            REF_FINANCIAL_STATEMENT_FY: { type: 'string', format: 'date', nullable: true },
          },
        },
        RequestedDetailsUpdate: {
          type: 'object',
          required: ['IS_TERM_REQUESTED', 'IS_LIMIT_REQUESTED'],
          properties: {
            IS_TERM_REQUESTED: { type: 'boolean' },
            IS_LIMIT_REQUESTED: { type: 'boolean' },
            REQUESTED_SALES_GROUP: { type: 'string' },
            REQUESTED_CUSTOMER_TYPE: { type: 'string' },
            REQUESTED_LIMIT_AMOUNT: { type: 'number', minimum: 0, nullable: true },
            REQUESTED_TERM_ID: { type: 'string' },
            REQUESTED_RATING_ID: { type: 'string' },
            REQUESTED_SELLING_TYPE: { type: 'string' },
            REQUESTED_EXPECTED_SALES_AMOUNT: { type: 'number', minimum: 0, nullable: true },
            REQUESTED_DELIVERY_FREQUENCY: { type: 'string', maxLength: 50 },
            REQUESTED_ADDITIONAL_EXPECTED_AMOUNT: { type: 'number', minimum: 0, nullable: true },
            REQUESTED_NOTES: { type: 'string' },
            BDS_NOTES: { type: 'string', description: 'Rich-text notes, limited to 8 MiB.' },
          },
        },
        FinalApprovalUpdate: {
          type: 'object',
          required: [
            'IS_PERMANENT', 'IS_TEMPORARY', 'IS_CLEAR_OUTSTANDING_BALANCE',
            'IS_WITHIN_APPROVED_LIMIT', 'IS_BANK_GUARANTEE', 'BANK_GUARANTEE_AMOUNT',
            'IS_CASH_DEPOSIT', 'CASH_DEPOSIT_AMOUNT',
          ],
          properties: {
            DESCRIPTION: { type: 'string', description: 'Approval notes; rich text is limited to 8 MiB.' },
            LIMIT_AMOUNT: { type: 'number', minimum: 0, nullable: true },
            TERM_ID: { type: 'string', nullable: true },
            RATING_ID: { type: 'string', nullable: true },
            IS_PERMANENT: { type: 'boolean' },
            IS_TEMPORARY: { type: 'boolean' },
            VALID_FROM: { type: 'string', format: 'date', nullable: true },
            VALID_TO: { type: 'string', format: 'date', nullable: true },
            IS_CLEAR_OUTSTANDING_BALANCE: { type: 'boolean' },
            IS_WITHIN_APPROVED_LIMIT: { type: 'boolean' },
            IS_BANK_GUARANTEE: { type: 'boolean' },
            BANK_GUARANTEE_AMOUNT: { type: 'number', minimum: 0 },
            IS_CASH_DEPOSIT: { type: 'boolean' },
            CASH_DEPOSIT_AMOUNT: { type: 'number', minimum: 0 },
          },
        },
        ApprovalSubmitStep: {
          type: 'object',
          required: ['approverTypeId', 'approverId', 'approvalStep', 'sorting'],
          properties: {
            approverTypeId: { type: 'string' },
            approverId: { type: 'string' },
            approvalStep: { type: 'integer', minimum: 1 },
            sorting: { type: 'integer', minimum: 0 },
          },
        },
        ApprovalSubmitCommand: {
          type: 'object',
          required: ['customerInfo', 'creditSuggestion', 'scoringAndPayment', 'requestedDetails'],
          properties: {
            customerInfo: { $ref: '#/components/schemas/RequestCustomerInfoUpdate' },
            creditSuggestion: { $ref: '#/components/schemas/CreditSuggestionUpdate' },
            scoringAndPayment: { $ref: '#/components/schemas/ScoringAndPaymentUpdate' },
            requestedDetails: { $ref: '#/components/schemas/RequestedDetailsUpdate' },
            bdsReviewApproverId: { type: 'string', description: 'Optional; defaults to the authenticated employee code.' },
            steps: { type: 'array', items: { $ref: '#/components/schemas/ApprovalSubmitStep' }, description: 'Approval routing; an omitted or empty array submits without approval steps.' },
            approvalCustomization: {
              type: 'object',
              required: ['description', 'defaultSteps', 'selectedSteps'],
              properties: {
                description: { type: 'string' },
                defaultSteps: { type: 'array', items: { $ref: '#/components/schemas/ApprovalSubmitStep' } },
                selectedSteps: { type: 'array', items: { $ref: '#/components/schemas/ApprovalSubmitStep' } },
              },
            },
          },
        },
        CloneRequestData: {
          type: 'object',
          required: ['sourceRequestId'],
          properties: {
            sourceRequestId: { type: 'string', description: 'Different active request to copy data and financial-analysis attachments from.' },
          },
        },
        CancelRequest: {
          type: 'object',
          required: ['cancelledNotes'],
          properties: {
            cancelledNotes: { type: 'string', minLength: 1, description: 'Required cancellation reason.' },
          },
        },
        EmailResendRequest: {
          type: 'object',
          required: ['emailIds'],
          properties: {
            emailIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
              description: 'Email log IDs to resend.',
            },
          },
        },
        PermissionUpdate: {
          type: 'object',
          required: ['permissions'],
          properties: {
            permissions: {
              type: 'array',
              minItems: 1,
              items: { $ref: '#/components/schemas/PermissionSelection' },
            },
          },
        },
        PermissionSelection: {
          type: 'object',
          required: ['NAME', 'GRANTED'],
          properties: {
            NAME: { type: 'string', minLength: 1, description: 'Permission name.' },
            GRANTED: { type: 'boolean', description: 'Whether the permission is granted.' },
          },
        },
        UserCreateRequest: {
          type: 'object',
          required: ['employeeCode', 'roleIds', 'permissionIds', 'enabled'],
          properties: {
            employeeCode: { type: 'string', minLength: 1 },
            roleIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            permissionIds: { type: 'array', items: { type: 'string', minLength: 1 } },
            enabled: { type: 'boolean' },
          },
        },
        UserAccessUpdate: {
          type: 'object',
          required: ['roleIds', 'permissionIds', 'enabled'],
          properties: {
            roleIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            permissionIds: { type: 'array', items: { type: 'string', minLength: 1 } },
            enabled: { type: 'boolean' },
          },
        },
        ApproverWriteRequest: {
          type: 'object',
          required: ['employeeCode', 'approverTypeId', 'enabled'],
          properties: {
            employeeCode: { type: 'string', minLength: 1 },
            approverTypeId: { type: 'string', minLength: 1 },
            enabled: { type: 'boolean' },
            primary: { type: 'boolean' },
            description: { type: 'string' },
          },
        },
        CustomerUpdate: {
          type: 'object',
          minProperties: 1,
          properties: {
            TAX_NO: { type: 'string', minLength: 1, maxLength: 13 },
            REGISTERED_DATE: { type: 'string', nullable: true, description: 'YYYY-MM-DD or DD/MM/YYYY.' },
            REGISTERED_CAPITAL_AMOUNT: {
              oneOf: [
                { type: 'number', minimum: 0, nullable: true },
                { type: 'string', pattern: '^\\d+(\\.\\d{1,4})?$', nullable: true },
              ],
              description: 'Decimal amount with at most four fractional digits.',
            },
            SIZE_ID: { type: 'string', description: 'Must reference an enabled customer size.' },
            CUSTOMER_TYPE_EXTER: { type: 'string', maxLength: 2048 },
            DIRECTORS: { type: 'string', maxLength: 2048 },
            SHAREHOLDERS: { type: 'string', maxLength: 2048 },
          },
        },
        CustomerCreateRequest: {
          allOf: [
            { $ref: '#/components/schemas/CustomerUpdate' },
            { type: 'object', required: ['TAX_NO'] },
          ],
        },
        RequestStatusChange: {
          type: 'object',
          required: ['statusId', 'description'],
          properties: {
            statusId: { type: 'string', description: 'Target request status ID.' },
            description: { type: 'string', minLength: 1, maxLength: 2000, description: 'Required reason for the status change.' },
            updateApprovers: { type: 'boolean', default: false },
            approveAllApprovers: { type: 'boolean', default: false },
            updateSalesforce: { type: 'boolean', default: false, description: 'Request CRM synchronization; only supported for Cancelled, Completed, or Rejected.' },
          },
        },
        ApprovalAction: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['save', 'approve', 'reject', 'backward', 'finalConfirm', 'finalCancel'] },
            APPROVAL_ID: { type: 'string', description: 'Required for save, approve, reject, and backward actions.' },
            DESCRIPTION: { type: 'string', description: 'Approval notes or backward reason; rich text is limited to 8 MiB.' },
            LIMIT_AMOUNT: { type: 'number', minimum: 0, nullable: true },
            TERM_ID: { type: 'string', nullable: true },
            RATING_ID: { type: 'string', nullable: true },
            IS_PERMANENT: { type: 'boolean' },
            IS_TEMPORARY: { type: 'boolean' },
            VALID_FROM: { type: 'string', format: 'date', nullable: true },
            VALID_TO: { type: 'string', format: 'date', nullable: true },
            IS_CLEAR_OUTSTANDING_BALANCE: { type: 'boolean' },
            IS_WITHIN_APPROVED_LIMIT: { type: 'boolean' },
            IS_BANK_GUARANTEE: { type: 'boolean' },
            BANK_GUARANTEE_AMOUNT: { type: 'number', minimum: 0 },
            IS_CASH_DEPOSIT: { type: 'boolean' },
            CASH_DEPOSIT_AMOUNT: { type: 'number', minimum: 0 },
          },
          additionalProperties: true,
        },
        EmailReminderSettings: {
          type: 'object',
          required: ['intervalValue', 'intervalUnit', 'enabled'],
          properties: {
            intervalValue: { type: 'integer', minimum: 1, maximum: 365 },
            intervalUnit: { type: 'string', enum: ['minutes', 'hours', 'days'] },
            enabled: { type: 'boolean' },
          },
        },
        MaintenanceUpdate: {
          type: 'object',
          required: ['enabled', 'message', 'startsAt', 'endsAt'],
          properties: {
            enabled: { type: 'boolean' },
            message: { type: 'string', maxLength: 4000, description: 'Plain-text maintenance announcement.' },
            startsAt: { type: 'string', format: 'date-time', nullable: true, description: 'ISO 8601 timestamp with timezone; null when disabled and unscheduled.' },
            endsAt: { type: 'string', format: 'date-time', nullable: true, description: 'ISO 8601 timestamp with timezone; must be later than startsAt.' },
          },
        },
        ErrorResponse: {
          type: 'object',
          required: ['success', 'error', 'correlationId'],
          properties: {
            success: {
              type: 'boolean',
              example: false,
              description: 'Indicates request failure',
            },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: {
                  type: 'string',
                  example: 'VALIDATION_ERROR',
                  description: 'Machine-readable error code',
                },
                message: {
                  type: 'string',
                  example: 'One or more validation errors occurred',
                  description: 'Human-readable error message (sanitized)',
                },
              },
            },
            correlationId: {
              type: 'string',
              format: 'uuid',
              description: 'Unique identifier for request tracing',
            },
          },
        },
        AuthenticatedUser: {
          type: 'object',
          required: ['oid', 'tid', 'email', 'displayName', 'roles'],
          properties: {
            oid: {
              type: 'string',
              format: 'uuid',
              description: 'User object ID from Microsoft Entra ID',
            },
            tid: {
              type: 'string',
              format: 'uuid',
              description: 'Tenant ID from Microsoft Entra ID',
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
            },
            displayName: {
              type: 'string',
              description: 'User display name',
            },
            roles: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'Assigned application roles',
            },
            profile: {
              type: 'object',
              additionalProperties: true,
              description: 'Sanitized e-Credit user profile; logged-in identity internals are excluded.',
            },
          },
        },
        HealthResponse: {
          type: 'object',
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              example: 'live',
              description: 'Status returned by the health handler.',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Health check timestamp',
            },
          },
        },
      },
    },
    security: [],
    tags: [
      { name: 'Public', description: 'Endpoints accessible without authentication' },
      { name: 'Authentication', description: 'Current user identity and profile' },
      { name: 'Session', description: 'Session heartbeat and browser tab presence' },
      { name: 'Health', description: 'Application and CRM health checks' },
      { name: 'Documentation', description: 'Interactive documentation and OpenAPI JSON' },
      { name: 'Requests', description: 'Credit request search, details, and data updates' },
      { name: 'Approval Workflow', description: 'Request submission, approval actions, and approval history' },
      { name: 'Attachments', description: 'Request attachment metadata and file operations' },
      { name: 'Customers', description: 'Customer search, maintenance, and audit history' },
      { name: 'Company Information', description: 'External company information suggestions and source links' },
      { name: 'Permissions', description: 'Effective permission catalog and role permission management' },
      { name: 'Users', description: 'User directory, access, permissions, and View As administration' },
      { name: 'Approvers', description: 'Approver configuration and employee options' },
      { name: 'Event Logs', description: 'Authentication, Administration, and request event log search and details' },
      { name: 'Email Logs', description: 'Email log inspection and controlled resend operations' },
      { name: 'Email Approval', description: 'Token-based approval actions from email links' },
      { name: 'Notifications', description: 'Authenticated user notification inbox and read state' },
      { name: 'Email Reminders', description: 'Workflow reminder configuration and previews' },
      { name: 'System Maintenance', description: 'Maintenance status and administrator schedule configuration' },
    ],
    paths,
  },
  apis: [],
};

/**
 * Get Swagger/OpenAPI specification
 * Generated from the documented API operation registry above.
 *
 * @returns {Object} OpenAPI 3.x specification object
 */
function getSwaggerSpec() {
  return swaggerJsdoc(options);
}

module.exports = {
  getSwaggerSpec,
  options,
};
