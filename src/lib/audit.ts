/**
 * VeriFace Edge — Hash-Chained Audit Log
 *
 * Append-only audit log. Each entry's `thisHash` is computed as:
 *   thisHash = SHA-256(prevHash || eventType || payload || ts || tenantId)
 *
 * Tamper-evident: any modification breaks the chain. The chain is
 * verifiable by walking from the genesis entry (prevHash = "0".repeat(64))
 * to the latest.
 *
 * Audit entries are retained for 7 years (GDPR / SOX / financial
 * regulation requirement). Soft-deleted tenant data still leaves an
 * audit trail proving deletion occurred.
 */

import { db } from '@/lib/db'
import { sha256Hex, utf8 } from '@/lib/crypto-server'
import { broadcastAuditEntry } from '@/lib/audit-stream'

export type AuditEventType =
  | 'session.init'
  | 'session.verify.start'
  | 'auth.success'
  | 'auth.failure'
  | 'enroll.success'
  | 'enroll.failure'
  | 'template.revoked'
  | 'key.rotated'
  | 'tenant.created'
  | 'tenant.deactivated'
  | 'tenant.plan_changed'
  | 'tenant.config_updated'
  | 'billing.invoice_created'
  | 'billing.payment_confirmed'
  | 'billing.payment_failed'
  | 'billing.price_mismatch_rejected'
  | 'billing.usage_reported'
  | 'billing.crypto_invoice_created'
  | 'billing.threshold_alert'
  | 'billing.limit_reached'
  | 'webhook.delivered'
  | 'webhook.dead_lettered'
  | 'webhook.url_updated'
  | 'webhook.secret_rotated'
  | 'injection.suspected'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'api_key.used'
  | 'token.revoked'
  | 'token.verified'
  | 'webauthn.enrolled'
  | 'webauthn.verified'
  | 'rate_limit.exceeded'
  | 'session.expired'
  | 'session.cleanup'
  | 'consent.recorded'
  | 'consent.withdrawn'
  | 'data.exported'
  | 'data.retention_cleanup'
  | 'user.password_changed'
  | 'user.account_deleted'
  | 'user.team_member_invited'
  | 'user.team_member_removed'
  | 'user.team_member_role_changed'
  | 'user.two_factor_enabled'
  | 'user.two_factor_disabled'
  | 'user.saml_configured'
  | 'user.access_policy_updated'
  | 'user.branding_updated'
  | 'user.region_updated'
  | 'compliance.access_review_completed'
  | 'security.blocklist_updated'

export interface AuditEvent {
  tenantId: string
  eventType: AuditEventType
  payload: Record<string, unknown>
  actorIp?: string
  apiKeyId?: string
}

const GENESIS_HASH = '0'.repeat(64)

// ---------------------------------------------------------------------------
// PII redaction (SECURITY FIX M-4)
// ---------------------------------------------------------------------------
// The audit log is retained for 7 years (GDPR/SOX). If PII (email, IP,
// userId, externalUserId, biometric hashes) is stored in plaintext in the
// payload, a DB compromise exposes all of it. We redact known PII fields
// before persisting.
//
// Approach: recursively walk the payload object and replace values for
// known PII keys with a SHA-256 prefix (first 12 chars). This preserves
// the ability to correlate events by the same PII value (same hash prefix)
// without storing the raw value.

const PII_KEYS = new Set([
  'email',
  'mail',
  'ip',
  'actorIp',
  'clientIp',
  'userId',
  'user_id',
  'externalUserId',
  'external_user_id',
  'phoneNumber',
  'phone',
  'name',
  'fullName',
  'full_name',
  'address',
  'street',
  'city',
  'zip',
  'postalCode',
  'ssn',
  'nationalId',
  'dateOfBirth',
  'dob',
  'password',
  'currentPassword',
  'newPassword',
  'secret',
  'totpSecret',
  'twoFactorSecret',
  'backupCode',
  'backupCodes',
  'apiKey',
  'api_key',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'cookie',
  'authorization',
  // SECURITY FIX (B-11): Additional PII / sensitive fields that were missing.
  'sub',              // JWT subject (often externalUserId)
  'session_id',       // Can correlate to a user
  'sessionId',
  'jti',              // JWT ID — can correlate to a session
  'cosine',           // Biometric match score (sensitive)
  'cosineSimilarity',
  'liveness',         // Biometric liveness scores (sensitive)
  'livenessScore',
  'rppg',             // rPPG signal data (biometric)
  'rppgHeartRateBpm',
  'rppgSnr',
  'padTexture',       // PAD scores (biometric)
  'padDepth',
  'padCombined',
  'txHash',           // Blockchain tx hash (can de-anonymize crypto payments)
  'payAddress',       // Crypto payment address
  'payFrom',          // Crypto source address
  'stripeCustomerId', // PII (payment identifier)
  'stripeSubscriptionId',
  'stripePriceId',
  'itemId',           // Stripe subscription item ID
  'subscriptionId',
  'inviteToken',      // Team invite token (secret)
  'inviteTokenHash',
  'revocationToken',  // Crypto-erasure token (secret)
  'templateSalt',     // DEK derivation salt (secret)
  'kmsKeyId',         // KMS key identifier
  'commitment',       // ZK commitment (biometric-derived)
  'commitmentNonce',
  'encryptedVector',  // Encrypted embedding (biometric)
  'iv',               // AES-GCM IV (not secret, but sensitive context)
  'authTag',
  'ciphertext',
  'privateKey',
  'signingPrivateKey',
  'signingPubKey',
  'webhookSecret',
  'ipnSecret',
  'passwordHash',
  'hmacKey',
  'dedupKey',
])

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    // Keep short strings non-identifiable but correlatable
    if (value.length === 0) return value
    return `[redacted:${sha256Hex(value).slice(0, 12)}]`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(redactValue)
  }
  if (typeof value === 'object') {
    return redactPii(value as Record<string, unknown>)
  }
  return value
}

function redactPii(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (PII_KEYS.has(key)) {
      redacted[key] = redactValue(value)
    } else if (value !== null && typeof value === 'object') {
      redacted[key] = redactValue(value)
    } else {
      redacted[key] = value
    }
  }
  return redacted
}

export async function appendAudit(event: AuditEvent): Promise<{
  id: string
  chainIndex: number
  thisHash: string
}> {
  // SECURITY FIX (M-4): Redact PII before persisting to the audit log.
  // The audit log is retained for 7 years — plaintext PII would be a
  // goldmine for an attacker with DB access.
  const redactedPayload = redactPii(event.payload)
  const payloadStr = JSON.stringify(redactedPayload)
  const MAX_RETRIES = 3

  // FIX (H8): Use a transaction with retry on unique constraint violation.
  // The @@unique([tenantId, chainIndex]) constraint prevents two concurrent
  // writes from getting the same chainIndex. On collision, retry.
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        // Fetch the latest entry for this tenant INSIDE the transaction
        const latest = await tx.auditLog.findFirst({
          where: { tenantId: event.tenantId },
          orderBy: { chainIndex: 'desc' },
        })

        const prevHash = latest?.thisHash ?? GENESIS_HASH
        const chainIndex = (latest?.chainIndex ?? -1) + 1

        // Create entry with placeholder hash
        const entry = await tx.auditLog.create({
          data: {
            tenantId: event.tenantId,
            eventType: event.eventType,
            payload: payloadStr,
            prevHash,
            thisHash: 'pending',
            chainIndex,
            actorIp: event.actorIp,
            apiKeyId: event.apiKeyId,
          },
        })

        // Compute thisHash using the actual createdAt from Prisma
        const ts = entry.createdAt.toISOString()
        const chainInput =
          prevHash + '|' + event.eventType + '|' + payloadStr + '|' + ts + '|' + event.tenantId
        const thisHash = sha256Hex(chainInput)

        // Update with real hash
        await tx.auditLog.update({
          where: { id: entry.id },
          data: { thisHash },
        })

        // Broadcast to SSE/WS subscribers (real-time SIEM streaming)
        // SECURITY FIX (M-4): Broadcast the REDACTED payload, not the raw one.
        broadcastAuditEntry({
          tenantId: event.tenantId,
          eventType: event.eventType,
          payload: redactedPayload,
          chainIndex,
          thisHash,
          actorIp: event.actorIp,
          createdAt: entry.createdAt,
        })

        return { id: entry.id, chainIndex, thisHash }
      })
    } catch (e: any) {
      // Retry on unique constraint violation (P2002)
      if (e?.code === 'P2002' && attempt < MAX_RETRIES - 1) {
        continue
      }
      throw e
    }
  }
  throw new Error('appendAudit: max retries exceeded')
}

/**
 * Verify the integrity of the audit chain for a tenant.
 * Returns the first broken entry, or null if the chain is intact.
 */
export async function verifyAuditChain(tenantId: string): Promise<{
  valid: boolean
  brokenAt?: number
  expectedHash?: string
  actualHash?: string
}> {
  const entries = await db.auditLog.findMany({
    where: { tenantId },
    orderBy: { chainIndex: 'asc' },
  })

  let prevHash = GENESIS_HASH
  for (const entry of entries) {
    if (entry.prevHash !== prevHash) {
      return {
        valid: false,
        brokenAt: entry.chainIndex,
        expectedHash: prevHash,
        actualHash: entry.prevHash,
      }
    }
    const chainInput =
      entry.prevHash + '|' + entry.eventType + '|' + entry.payload + '|' +
      entry.createdAt.toISOString() + '|' + entry.tenantId
    const recomputed = sha256Hex(chainInput)
    if (recomputed !== entry.thisHash) {
      return {
        valid: false,
        brokenAt: entry.chainIndex,
        expectedHash: recomputed,
        actualHash: entry.thisHash,
      }
    }
    prevHash = entry.thisHash
  }

  return { valid: true }
}

/**
 * Query audit log for a tenant with cursor-based pagination.
 *
 * Cursor-based pagination (not offset) is used because:
 *   - Consistent results even if new entries are added between pages
 *   - Better performance at scale (no COUNT OFFSET)
 *   - Standard for time-series data
 *
 * Cursor format: base64(chainIndex:createdAt)
 */
export async function queryAuditLog(
  tenantId: string,
  opts: {
    limit?: number
    cursor?: string  // base64-encoded cursor
    eventType?: AuditEventType
    from?: Date
    to?: Date
  } = {},
): Promise<{ entries: any[]; nextCursor: string | null; hasMore: boolean }> {
  const limit = Math.min(opts.limit ?? 50, 200)

  // Decode cursor
  let cursorChainIndex: number | undefined
  let cursorCreatedAt: Date | undefined
  if (opts.cursor) {
    try {
      const decoded = Buffer.from(opts.cursor, 'base64').toString('utf-8')
      const [idx, ts] = decoded.split(':')
      cursorChainIndex = parseInt(idx, 10)
      cursorCreatedAt = new Date(ts)
    } catch {
      // Invalid cursor — ignore
    }
  }

  const entries = await db.auditLog.findMany({
    where: {
      tenantId,
      ...(opts.eventType ? { eventType: opts.eventType } : {}),
      ...(opts.from || opts.to
        ? {
            createdAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
      // Cursor: get entries BEFORE the cursor (descending order)
      ...(cursorChainIndex !== undefined
        ? { chainIndex: { lt: cursorChainIndex } }
        : {}),
    },
    orderBy: { chainIndex: 'desc' },
    take: limit + 1,  // Fetch one extra to check if there's more
  })

  const hasMore = entries.length > limit
  const results = hasMore ? entries.slice(0, limit) : entries

  // Generate next cursor from the last entry
  let nextCursor: string | null = null
  if (hasMore && results.length > 0) {
    const last = results[results.length - 1]
    nextCursor = Buffer.from(`${last.chainIndex}:${last.createdAt.toISOString()}`).toString('base64')
  }

  return { entries: results, nextCursor, hasMore }
}
