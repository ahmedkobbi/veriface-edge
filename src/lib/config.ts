/**
 * VeriFace Edge — Server Configuration
 *
 * Loads sensitive configuration from environment variables.
 * In production, these MUST be set — the server refuses to start if missing.
 *
 * Secrets management:
 *   - VERIFACE_SERVER_SIGNING_KEY: Ed25519 private key (hex, 64 chars)
 *   - VERIFACE_ENCRYPTION_KEY: AES-256 master key (hex, 64 chars)
 *   - VERIFACE_DB_ENCRYPTION_KEY: Database field-level encryption key
 *
 * Generate keys:
 *   node -e "const {ed25519Generate} = require('./src/lib/crypto-server'); const k = ed25519Generate(); console.log('Private:', Buffer.from(k.privateKey).toString('hex')); console.log('Public:', Buffer.from(k.publicKey).toString('hex'))"
 */

import { ed25519Generate, type Ed25519KeyPair, hex } from '@/lib/crypto-server'
import { ed25519 } from '@noble/curves/ed25519.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// SECURITY FIX (I-1): Production boot guards — refuse to start with insecure config.
// ---------------------------------------------------------------------------

// I-1: Refuse to boot in production with SQLite (or missing DATABASE_URL).
// SQLite lacks row-level security, concurrent write safety, and TLS — all
// required for a multi-tenant SaaS handling biometric data.
if (process.env.NODE_ENV === 'production') {
  const dbUrl = process.env.DATABASE_URL ?? ''
  if (dbUrl === '') {
    throw new Error(
      'FATAL: DATABASE_URL is not set. Production requires PostgreSQL. ' +
      'Example: postgresql://user:pass@host:5432/veriface?schema=public'
    )
  }
  if (dbUrl.startsWith('file:')) {
    throw new Error(
      'FATAL: SQLite (file: URL) is not supported in production. Set DATABASE_URL to a PostgreSQL connection string. ' +
      'Example: postgresql://user:pass@host:5432/veriface?schema=public'
    )
  }
  // Require postgresql:// scheme (reject mysql://, mongodb://, etc.)
  if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    throw new Error(
      `FATAL: DATABASE_URL must use PostgreSQL (got "${dbUrl.split(':')[0]}://"). ` +
      'Set DATABASE_URL to a postgresql:// connection string.'
    )
  }
  // Require TLS in production (sslmode=require or sslmode=verify-full)
  if (!dbUrl.includes('sslmode=require') && !dbUrl.includes('sslmode=verify-full') && !dbUrl.includes('sslmode=prefer')) {
    logger.warn(
      'DATABASE_URL does not specify sslmode — production connections should use sslmode=verify-full for TLS.'
    )
  }
}

// ---------------------------------------------------------------------------
// SECURITY FIX (I-4): VERIFACE_ALLOW_INSECURE_DEV footgun — refuse in production.
// ---------------------------------------------------------------------------

// I-4: If VERIFACE_ALLOW_INSECURE_DEV is set in production, REFUSE to boot.
// This env var enables ephemeral signing keys, which means all session tokens
// are invalid after a restart — unacceptable for production. Setting it in
// production is almost always a mistake (copy-pasted .env from dev).
if (process.env.NODE_ENV === 'production' && process.env.VERIFACE_ALLOW_INSECURE_DEV) {
  throw new Error(
    'FATAL: VERIFACE_ALLOW_INSECURE_DEV is set in production. ' +
    'This flag enables insecure ephemeral keys and MUST NOT be used in production. ' +
    'Remove it from your environment and set VERIFACE_SERVER_SIGNING_KEY instead.'
  )
}

let serverKeyPair: Ed25519KeyPair | null = null

/**
 * Get the server's Ed25519 signing keypair.
 *
 * Priority:
 *   1. VERIFACE_SERVER_SIGNING_KEY environment variable (production)
 *   2. Runtime-generated (development only — logs a warning)
 */
export function getServerSigningKey(): Ed25519KeyPair {
  if (serverKeyPair) return serverKeyPair

  const envKey = process.env.VERIFACE_SERVER_SIGNING_KEY

  if (envKey) {
    // Validate format: 64 hex chars (32 bytes)
    if (!/^[0-9a-f]{64}$/i.test(envKey)) {
      throw new Error('VERIFACE_SERVER_SIGNING_KEY must be 64 hex chars (32 bytes)')
    }
    const privateKey = hex.decode(envKey)
    const publicKey = ed25519.getPublicKey(privateKey)
    serverKeyPair = { publicKey, privateKey }
    return serverKeyPair
  }

  // Development fallback: generate ephemeral key with LOUD warning
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'VERIFACE_SERVER_SIGNING_KEY environment variable is required in production. ' +
      'Generate one with: node -e "const {ed25519Generate} = require(\'./src/lib/crypto-server\'); console.log(Buffer.from(ed25519Generate().privateKey).toString(\'hex\'))"'
    )
  }

  // In development, refuse to start if explicit dev key not set
  if (!process.env.VERIFACE_ALLOW_INSECURE_DEV) {
    throw new Error(
      'VERIFACE_SERVER_SIGNING_KEY is not set. For development, set VERIFACE_ALLOW_INSECURE_DEV=1 to allow ephemeral keys. ' +
      'For production, set VERIFACE_SERVER_SIGNING_KEY to a 64-hex-char Ed25519 private key.'
    )
  }

  logger.warn(
    '[VeriFace] ⚠️  WARNING: VERIFACE_SERVER_SIGNING_KEY not set — using ephemeral key. ' +
    'Tokens will not survive server restart. Set VERIFACE_ALLOW_INSECURE_DEV=0 and provide a real key.'
  )
  serverKeyPair = ed25519Generate()
  return serverKeyPair
}

/**
 * Get the master encryption key for database field-level encryption.
 */
export function getMasterEncryptionKey(): Uint8Array {
  const envKey = process.env.VERIFACE_ENCRYPTION_KEY
  if (envKey) {
    if (!/^[0-9a-f]{64}$/i.test(envKey)) {
      throw new Error('VERIFACE_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
    }
    return hex.decode(envKey)
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('VERIFACE_ENCRYPTION_KEY environment variable is required in production')
  }

  logger.warn('VERIFACE_ENCRYPTION_KEY not set — using random ephemeral key (dev only)')
  return randomBytes(32)
}

/**
 * PII Redaction — sanitize error messages before returning to client.
 *
 * Removes:
 *   - Email addresses
 *   - Phone numbers
 *   - IP addresses (partial)
 *   - API keys
 *   - Hex strings longer than 32 chars (potential keys/hashes)
 *   - File paths
 *   - Stack traces
 */
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '[PHONE]' },
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '[IP]' },
  { pattern: /vf_(live|test)_[0-9a-f]{32}/gi, replacement: '[API_KEY]' },
  { pattern: /\b[0-9a-f]{64}\b/gi, replacement: '[HASH]' },
  { pattern: /\b[0-9a-f]{32}\b/gi, replacement: '[TOKEN]' },
  { pattern: /\/[a-zA-Z0-9_\-\/]+\.(ts|js|tsx|py|go|rs)\b/g, replacement: '[FILE]' },
  { pattern: /at\s+[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+\s*\(/g, replacement: '[STACK_FRAME]' },
]

export function redactPII(message: string): string {
  let redacted = message
  for (const { pattern, replacement } of PII_PATTERNS) {
    redacted = redacted.replace(pattern, replacement)
  }
  return redacted
}

/**
 * Safe error response — redacts PII before returning to client.
 * Never exposes internal error details in production.
 */
export function safeErrorResponse(
  error: unknown,
  requestId?: string,
): { success: false; error: string; code: string; requestId?: string } {
  const isProd = process.env.NODE_ENV === 'production'

  if (error instanceof Error) {
    // In production, return generic error (no internal details)
    if (isProd) {
      return {
        success: false,
        error: 'An internal error occurred',
        code: 'INTERNAL_ERROR',
        requestId,
      }
    }
    // In development, return redacted error for debugging
    return {
      success: false,
      error: redactPII(error.message),
      code: 'INTERNAL_ERROR',
      requestId,
    }
  }

  return {
    success: false,
    error: 'Unknown error',
    code: 'UNKNOWN',
    requestId,
  }
}
