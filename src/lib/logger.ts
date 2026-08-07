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
      'apiKey',
      'api_key',
      'authorization',
      'Authorization',
      '*.apiKey',
      '*.api_key',
      '*.authorization',
      '*.Authorization',
      'signingPrivateKey',
      '*.signingPrivateKey',
      'webhookSecret',
      '*.webhookSecret',
      'embedding',
      '*.embedding',
      'encryptedVector',
      '*.encryptedVector',
      'plaintext',
      '*.plaintext',
      'token',
      '*.token',
      'jwt',
      '*.jwt',
      'privateKey',
      '*.privateKey',
      'sessionKey',
      '*.sessionKey',
      'dek',
      '*.dek',
      'password',
      '*.password',
      'secret',
      '*.secret',
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
