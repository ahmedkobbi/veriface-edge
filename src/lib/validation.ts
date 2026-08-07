/**
 * VeriFace Edge — Zod Validation Schemas
 *
 * Every API endpoint validates its input against these schemas.
 * Invalid input → 400 with specific error message (no internal leak).
 *
 * Defense against:
 *   - Malformed JSON injection
 *   - Oversized payloads (DoS)
 *   - Type confusion attacks
 *   - Unexpected field values
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const hexString = z.string().regex(/^[0-9a-f]+$/i, 'Must be hex string')
export const hexString64 = z.string().regex(/^[0-9a-f]{64}$/i, 'Must be 64-char hex (32 bytes)')
export const cuid = z.string().regex(/^c[a-z0-9]{20,}$/i, 'Invalid ID format')
export const apiKeyFormat = z.string().regex(/^vf_(live|test)_[0-9a-f]{32}$/, 'Invalid API key format')
export const httpsUrl = z.string().url().regex(/^https:\/\//i, 'Must be HTTPS URL')
export const externalUserId = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_\-\.@:]+$/, 'Invalid user ID characters')

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export const TenantCreateSchema = z.object({
  name: z.string().min(1).max(256),
})

export const TenantWebhookSchema = z.object({
  webhookUrl: httpsUrl.nullable(),
  webhookSecret: z.enum(['rotate']).optional(),
})

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const SessionInitSchema = z.object({
  flow: z.enum(['enroll', 'authenticate']),
  externalUserId: externalUserId.optional(),
})

export const SessionVerifySchema = z.object({
  sessionId: cuid,
  tenantId: cuid.optional(),  // derived from API key, but SDK sends it
  jwt: z.string().min(1).max(8192),
  sdkPubKey: hexString64,
  encryptedEmbedding: z.object({
    ciphertext: hexString,
    iv: hexString,
    authTag: hexString,
  }),
  commitment: hexString64,
  commitmentNonce: hexString64,
  liveness: z.object({
    rppg: z.number().min(0).max(1),
    rppgHeartRateBpm: z.number().int().min(0).max(300).nullable(),
    rppgSnr: z.number(),
    padTexture: z.number().min(0).max(1),
    padDepth: z.number().min(0).max(1),
    padCombined: z.number().min(0).max(1),
    overall: z.number().min(0).max(1),
  }),
  antiInjection: z.object({
    passed: z.boolean(),
    deviceScan: z.object({
      totalDevices: z.number().int(),
      realCameras: z.array(z.string()),
      virtualCameras: z.array(z.string()),
      suspiciousOnly: z.boolean(),
    }),
    timingStats: z.object({
      mean: z.number(),
      std: z.number(),
      cv: z.number(),
      samples: z.number().int(),
      synthetic: z.boolean(),
    }),
    replayDetected: z.boolean(),
    tamperCheck: z.object({
      passed: z.boolean(),
      violations: z.array(z.string()),
    }),
    attestation: z.object({
      platform: z.string(),
      attestationAvailable: z.boolean(),
      attestationData: z.string().nullable(),
      algorithm: z.string().nullable(),
    }),
    strobeChallenges: z.number().int(),
    strobeResponses: z.number().int(),
    failureReasons: z.array(z.string()),
  }),
  externalUserId: externalUserId.optional(),
})

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export const ApiKeyCreateSchema = z.object({
  label: z.string().min(1).max(128),
  scopes: z.string().max(256).optional(),
  environment: z.enum(['live', 'test']).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
})

export const ApiKeyRevokeSchema = z.object({
  apiKeyId: cuid,
})

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export const TokenVerifySchema = z.object({
  token: z.string().min(1).max(8192),
})

export const TokenRevokeSchema = z.object({
  token: z.string().min(1).max(8192),
  reason: z.string().max(256).optional(),
})

// ---------------------------------------------------------------------------
// Templates (GDPR)
// ---------------------------------------------------------------------------

export const TemplateDeleteSchema = z.object({
  externalUserId: externalUserId,
})

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  eventType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export const AuditExportSchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

// ---------------------------------------------------------------------------
// WebAuthn
// ---------------------------------------------------------------------------

export const WebAuthnRegisterBeginSchema = z.object({
  externalUserId: externalUserId,
  deviceType: z.enum(['platform', 'roaming']).optional(),
})

export const WebAuthnRegisterFinishSchema = z.object({
  sessionId: cuid,
  credentialId: z.string(),  // base64url
  publicKey: z.string(),     // base64url
  attestationObject: z.string().optional(),
  clientDataJSON: z.string(),
  transports: z.array(z.string()).optional(),
  aaguid: z.string().optional(),
  deviceType: z.enum(['platform', 'roaming']).optional(),
  backedUp: z.boolean().optional(),
})

export const WebAuthnAuthBeginSchema = z.object({
  externalUserId: externalUserId,
})

export const WebAuthnAuthFinishSchema = z.object({
  sessionId: cuid,
  credentialId: z.string(),
  authenticatorData: z.string(),
  clientDataJSON: z.string(),
  signature: z.string(),
})

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'
export const IdempotencyKeySchema = z.string().min(1).max(256)

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  // Format Zod errors into a readable message (don't leak internal structure)
  const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  return { success: false, error: messages.join('; ') }
}
