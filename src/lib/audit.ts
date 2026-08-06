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
  // Fetch the latest entry for this tenant to chain from.
  const latest = await db.auditLog.findFirst({
    where: { tenantId: event.tenantId },
    orderBy: { chainIndex: 'desc' },
  })

  const prevHash = latest?.thisHash ?? GENESIS_HASH
  const chainIndex = (latest?.chainIndex ?? -1) + 1
  const payloadStr = JSON.stringify(event.payload)

  // First create the entry to get the actual createdAt from Prisma.
  // We use a placeholder hash, then update it with the real hash.
  const entry = await db.auditLog.create({
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

  // Compute thisHash using the actual createdAt value from Prisma
  const ts = entry.createdAt.toISOString()
  const chainInput =
    prevHash + '|' + event.eventType + '|' + payloadStr + '|' + ts + '|' + event.tenantId
  const thisHash = sha256Hex(chainInput)

  // Update the entry with the real hash
  await db.auditLog.update({
    where: { id: entry.id },
    data: { thisHash },
  })

  return { id: entry.id, chainIndex, thisHash }
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
 * Query audit log for a tenant (with pagination).
 * Tenant scoping is enforced at the database query level.
 */
export async function queryAuditLog(
  tenantId: string,
  opts: {
    limit?: number
    offset?: number
    eventType?: AuditEventType
    from?: Date
    to?: Date
  } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0

  return db.auditLog.findMany({
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
    },
    orderBy: { chainIndex: 'desc' },
    take: limit,
    skip: offset,
  })
}
