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

export interface AuditEvent {
  tenantId: string
  eventType: AuditEventType
  payload: Record<string, unknown>
  actorIp?: string
  apiKeyId?: string
}

const GENESIS_HASH = '0'.repeat(64)

export async function appendAudit(event: AuditEvent): Promise<{
  id: string
  chainIndex: number
  thisHash: string
}> {
  const payloadStr = JSON.stringify(event.payload)
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
