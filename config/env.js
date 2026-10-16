const path = require('path');
const Joi = require('joi');

/**
 * Environment Configuration Module
 * Validates and loads environment variables based on NODE_ENV
 * Fails fast if NODE_ENV is invalid or required variables are missing
 */

// Define supported environments
const SUPPORTED_ENVIRONMENTS = ['dev', 'qas', 'prd'];

/**
 * Validation schema for all required environment variables
 */
const envSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string()
      .valid(...SUPPORTED_ENVIRONMENTS)
      .required(),
    PORT: Joi.number()
      .port()
      .required(),
    
    // Database Configuration
    DB_SERVER: Joi.string().required(),
    DB_INSTANCE_NAME: Joi.string().required(),
    DB_PORT: Joi.number().port().required(),
    DB_USER: Joi.string().required(),
    DB_PASSWORD: Joi.string().required(),
    DB_NAME: Joi.string().required(),
    DB_ENCRYPT: Joi.boolean().required(),
    DB_TRUST_SERVER_CERTIFICATE: Joi.boolean().required(),
    DB_POOL_MIN: Joi.number().integer().min(1).required(),
    DB_POOL_MAX: Joi.number().integer().min(1).required(),
    
    // JWT Configuration
    JWT_SECRET: Joi.string().min(8).required(),
    JWT_EXPIRES_IN: Joi.string().required(),
    
    // Application URLs
    APP_BASE_URL: Joi.string().uri().required(),
    FRONTEND_BASE_URL: Joi.string().uri().required(),
    SALESFORCE_BASE_URL: Joi.string().uri().required(),
    APP_CREATE_REQUEST_URL: Joi.string().uri().allow('').optional(),
    HEADER_KEY_CREATE_REQUEST: Joi.string().allow('').optional(),
    HEADER_VALUE_CREATE_REQUEST: Joi.string().allow('').optional(),
    CORS_ALLOWED_ORIGINS: Joi.string().required(),
    
    // Logging Configuration
    LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').required(),
    LOG_FORMAT: Joi.string().valid('json', 'text').required(),

    // Email Configuration
    EMAIL_SMTP_HOST: Joi.string().hostname().required(),
    EMAIL_SMTP_PORT: Joi.number().port().required(),
    EMAIL_SMTP_USER: Joi.string().email().required(),
    EMAIL_SMTP_PASSWORD: Joi.string().required(),
    EMAIL_FROM: Joi.string().email().required(),
    EMAIL_BCC: Joi.string().required(),

    // Attachment Storage Configuration
    ATTACHMENT_STORAGE_DIRECTORY: Joi.string().required(),
    ATTACHMENT_PUBLIC_BASE_URL: Joi.string().uri().required(),
    ATTACHMENT_MAX_FILE_SIZE: Joi.number().integer().positive().required(),
    DEFAULT_ATTACHMENT_TYPE_ID: Joi.string().guid().required(),
    ATTACHMENT_STORAGE_PROVIDER: Joi.string().valid('FILE_SHARE', 'SHAREPOINT').default('FILE_SHARE'),
    GRAPH_CLIENT_ID: Joi.string().guid().when('ATTACHMENT_STORAGE_PROVIDER', {
      is: 'SHAREPOINT', then: Joi.required(), otherwise: Joi.optional(),
    }),
    GRAPH_CLIENT_SECRET: Joi.string().when('ATTACHMENT_STORAGE_PROVIDER', {
      is: 'SHAREPOINT', then: Joi.required(), otherwise: Joi.optional(),
    }),
    GRAPH_DRIVE_ID: Joi.string().when('ATTACHMENT_STORAGE_PROVIDER', {
      is: 'SHAREPOINT', then: Joi.required(), otherwise: Joi.optional(),
    }),
    GRAPH_ROOT_FOLDER_ID: Joi.string().when('ATTACHMENT_STORAGE_PROVIDER', {
      is: 'SHAREPOINT', then: Joi.required(), otherwise: Joi.optional(),
    }),
    
    // HTTPS Configuration
    KEY_PATH: Joi.string().required(),
    CERT_PATH: Joi.string().required(),
    CA_PATH: Joi.string().required(),
    
    // MSAL Configuration
    MSAL_CLIENT_ID: Joi.string().guid().required(),
    MSAL_TENANT_ID: Joi.string().guid().required(),
    MSAL_AUTHORITY: Joi.string().uri().required(),
    MSAL_EXPECTED_AUDIENCE: Joi.string().required(),
    MSAL_EXPECTED_ISSUER: Joi.string().uri().required(),
    MSAL_API_CLIENT_ID: Joi.string().guid().required(),
    MSAL_API_SCOPE: Joi.string().required(),
    MSAL_GRAPH_ENDPOINT: Joi.string().uri().required(),

    // Power Platform company information lookup
    POWERPLATFORM_URL: Joi.string().uri({ scheme: ['https'] }).allow('').optional(),
    
    // Swagger Configuration
    SWAGGER_TITLE: Joi.string().required(),
    SWAGGER_DESCRIPTION: Joi.string().required(),
    SWAGGER_VERSION: Joi.string().required(),
  })
  .unknown(true)
  .required();

/**
 * Initialize and validate environment configuration
 * Reads .env file based on NODE_ENV and validates all required variables
 * 
 * @throws {Error} If NODE_ENV is missing, invalid, or required variables are missing
 */
function initializeEnvironment() {
  // Check if NODE_ENV is set
  if (!process.env.NODE_ENV) {
    console.error('FATAL: NODE_ENV environment variable is not set');
    console.error(`Supported values: ${SUPPORTED_ENVIRONMENTS.join(', ')}`);
    process.exit(1);
  }

  const env = process.env.NODE_ENV.toLowerCase();

  // Validate NODE_ENV is supported
  if (!SUPPORTED_ENVIRONMENTS.includes(env)) {
    console.error(`FATAL: Unsupported NODE_ENV="${env}"`);
    console.error(`Supported values: ${SUPPORTED_ENVIRONMENTS.join(', ')}`);
    process.exit(1);
  }

  // Load .env file based on NODE_ENV
  const envFilePath = path.resolve(__dirname, `../.env.${env}`);
  require('dotenv').config({ path: envFilePath });

  // Validate all environment variables
  const { value, error } = envSchema.validate(process.env, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    console.error('FATAL: Environment configuration validation failed:');
    error.details.forEach((detail) => {
      console.error(`  - ${detail.message}`);
    });
    process.exit(1);
  }

  return value;
}

/**
 * Get parsed CORS allowed origins as array
 * @param {string} corsAllowedOrigins - Comma-separated origins
 * @returns {string[]} Array of origins
 */
function parseCorsOrigins(corsAllowedOrigins) {
  return corsAllowedOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Configuration object exported after validation
 */
const config = initializeEnvironment();

module.exports = {
  // Application
  environment: config.NODE_ENV,
  port: parseInt(config.PORT, 10),
  appBaseUrl: config.APP_BASE_URL,
  frontendBaseUrl: config.FRONTEND_BASE_URL,
  salesforceBaseUrl: config.SALESFORCE_BASE_URL,
  createRequest: {
    url: config.APP_CREATE_REQUEST_URL || '',
    headerKey: config.HEADER_KEY_CREATE_REQUEST || '',
    headerValue: config.HEADER_VALUE_CREATE_REQUEST || '',
  },
  corsAllowedOrigins: parseCorsOrigins(config.CORS_ALLOWED_ORIGINS),
  
  // Database
  database: {
    server: config.DB_SERVER,
    instanceName: config.DB_INSTANCE_NAME,
    port: parseInt(config.DB_PORT, 10),
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    encrypt: config.DB_ENCRYPT === 'true' || config.DB_ENCRYPT === true,
    trustServerCertificate:
      config.DB_TRUST_SERVER_CERTIFICATE === 'true' || config.DB_TRUST_SERVER_CERTIFICATE === true,
    pool: {
      min: parseInt(config.DB_POOL_MIN, 10),
      max: parseInt(config.DB_POOL_MAX, 10),
      acquire: 30000,
      idle: 10000,
    },
  },
  
  // JWT
  jwt: {
    secret: config.JWT_SECRET,
    expiresIn: config.JWT_EXPIRES_IN,
  },
  
  // Logging
  logging: {
    level: config.LOG_LEVEL,
    format: config.LOG_FORMAT,
  },

  // Email
  email: {
    smtp: {
      host: config.EMAIL_SMTP_HOST,
      port: parseInt(config.EMAIL_SMTP_PORT, 10),
      secure: parseInt(config.EMAIL_SMTP_PORT, 10) === 465,
      user: config.EMAIL_SMTP_USER,
      password: config.EMAIL_SMTP_PASSWORD,
    },
    from: config.EMAIL_FROM,
    bcc: config.EMAIL_BCC,
  },

  // Attachments
  attachments: {
    storageDirectory: config.ATTACHMENT_STORAGE_DIRECTORY,
    publicBaseUrl: config.ATTACHMENT_PUBLIC_BASE_URL.replace(/\/$/, ''),
    maxFileSize: config.ATTACHMENT_MAX_FILE_SIZE,
    defaultTypeId: config.DEFAULT_ATTACHMENT_TYPE_ID,
    storageProvider: config.ATTACHMENT_STORAGE_PROVIDER,
    graph: {
      clientId: config.GRAPH_CLIENT_ID,
      clientSecret: config.GRAPH_CLIENT_SECRET,
      tenantId: config.MSAL_TENANT_ID,
      endpoint: config.MSAL_GRAPH_ENDPOINT.replace(/\/$/, ''),
      driveId: config.GRAPH_DRIVE_ID,
      rootFolderId: config.GRAPH_ROOT_FOLDER_ID,
    },
  },
  
  // HTTPS
  https: {
    keyPath: config.KEY_PATH,
    certPath: config.CERT_PATH,
    caPath: config.CA_PATH,
  },
  
  // MSAL
  msal: {
    clientId: config.MSAL_CLIENT_ID,
    tenantId: config.MSAL_TENANT_ID,
    authority: config.MSAL_AUTHORITY,
    expectedAudience: config.MSAL_EXPECTED_AUDIENCE,
    expectedIssuer: config.MSAL_EXPECTED_ISSUER,
    apiClientId: config.MSAL_API_CLIENT_ID,
    apiScope: config.MSAL_API_SCOPE,
    graphEndpoint: config.MSAL_GRAPH_ENDPOINT,
  },

  // Power Platform company information lookup
  powerPlatformUrl: config.POWERPLATFORM_URL || '',
  
  // Swagger
  swagger: {
    title: config.SWAGGER_TITLE,
    description: config.SWAGGER_DESCRIPTION,
    version: config.SWAGGER_VERSION,
  },
  
  // Utility functions
  isProduction: () => config.NODE_ENV === 'prd',
  isStaging: () => config.NODE_ENV === 'qas',
  isDevelopment: () => config.NODE_ENV === 'dev',
};
