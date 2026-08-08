/**
 * VeriFace Edge — Structured Logging (pino)
 *
 * Production-grade structured logging with:
 *   - Request ID correlation (passed via X-Request-ID header)
 *   - Log levels: trace, debug, info, warn, error, fatal
 *   - JSON output (parseable by ELK / Datadog / CloudWatch)
 *   - Sensitive data redaction (API keys, embeddings, tokens)
 *   - PII never logged (no face data, no user names)
 */

import pino from 'pino'

const LOG_LEVEL = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

export const logger = pino({
  level: LOG_LEVEL,
  redact: {
    paths: [
      // API keys / auth headers
      'apiKey',
      'api_key',
      'authorization',
      'Authorization',
      '*.apiKey',
      '*.api_key',
      '*.authorization',
      '*.Authorization',
      'x-api-key',
      'X-API-Key',
      '*.x-api-key',
      '*.X-API-Key',
      // Signing / crypto private material
      'signingPrivateKey',
      '*.signingPrivateKey',
      'signingPubKey',
      '*.signingPubKey',
      'privateKey',
      '*.privateKey',
      'publicKey',
      '*.publicKey',
      'webhookSecret',
      '*.webhookSecret',
      'ipnSecret',
      '*.ipnSecret',
      'NOWPAYMENTS_IPN_SECRET',
      'NOWPAYMENTS_API_KEY',
      'STRIPE_SECRET_KEY',
      'stripeSecretKey',
      '*.stripeSecretKey',
      // Biometric data
      'embedding',
      '*.embedding',
      'encryptedVector',
      '*.encryptedVector',
      'encryptedEmbedding',
      '*.encryptedEmbedding',
      'template',
      '*.template',
      'biometricTemplate',
      '*.biometricTemplate',
      // Plaintext secrets
      'plaintext',
      '*.plaintext',
      'plainText',
      '*.plainText',
      // Tokens / JWTs
      'token',
      '*.token',
      'jwt',
      '*.jwt',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      'sessionToken',
      '*.sessionToken',
      'pendingToken',
      '*.pendingToken',
      'cookie',
      '*.cookie',
      'setCookie',
      '*.setCookie',
      // Session / DEK
      'sessionKey',
      '*.sessionKey',
      'dek',
      '*.dek',
      'sessionPrivKey',
      '*.sessionPrivKey',
      // Passwords
      'password',
      '*.password',
      'currentPassword',
      '*.currentPassword',
      'newPassword',
      '*.newPassword',
      'tempPassword',
      '*.tempPassword',
      'passwordHash',
      '*.passwordHash',
      // 2FA secrets
      'secret',
      '*.secret',
      'totpSecret',
      '*.totpSecret',
      'twoFactorSecret',
      '*.twoFactorSecret',
      'backupCode',
      '*.backupCode',
      'backupCodes',
      '*.backupCodes',
      'twoFactorBackupCodes',
      '*.twoFactorBackupCodes',
      // PII (defense in depth — audit.ts also redacts)
      'ssn',
      '*.ssn',
      'nationalId',
      '*.nationalId',
      'dateOfBirth',
      '*.dateOfBirth',
      'dob',
      '*.dob',
      // KMS / HSM
      'kmsKeyId',
      '*.kmsKeyId',
      'hsmPin',
      '*.hsmPin',
      'PKCS11_PIN',
      // Connection strings / URLs with credentials
      'databaseUrl',
      'DATABASE_URL',
      'redisUrl',
      'REDIS_URL',
      '*.redisUrl',
      // Server signing key (config)
      'serverSigningKey',
      '*.serverSigningKey',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      service: 'veriface-edge',
      version: '1.0.0',
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'veriface-edge',
    version: '1.0.0',
  },
})

/**
 * Create a child logger with request context.
 * Usage:
 *   const log = createRequestLogger(requestId, tenantId)
 *   log.info({ sessionId }, 'Session initialized')
 */
export function createRequestLogger(requestId?: string, tenantId?: string) {
  return logger.child({
    requestId: requestId ?? 'unknown',
    ...(tenantId ? { tenantId } : {}),
  })
}

/**
 * Generate a new request ID (UUID v4).
 */
export function generateRequestId(): string {
  return crypto.randomUUID()
}
