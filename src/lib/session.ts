/**
 * VeriFace Edge — Session Lifecycle
 *
 * Manages the ephemeral challenge-response session between SDK and backend.
 *
 * Flow:
 *   1. SDK calls /session/init → backend creates Session with random
 *      challenge + ephemeral X25519 keypair. Returns sessionId,
 *      challenge, backendPubKey.
 *   2. SDK captures biometric, derives embedding, computes Pedersen
 *      commitment, signs JWT (Ed25519) with its session key.
 *   3. SDK calls /session/verify with { sessionId, jwt, commitment, liveness }.
 *   4. Backend verifies JWT signature, decrypts payload via ECDH-derived
 *      session key, verifies commitment, runs template match, issues token.
 *
 * SECURITY FIXES (M-2, M-3):
 *   M-2: In-memory state was not shared across instances — on a multi-instance
 *        deployment, the instance that handled /init may differ from the one
 *        handling /verify, causing the private key lookup to fail. Now we
 *        persist the ephemeral private key to Redis (with TTL matching the
 *        session expiry) when Redis is available. In-memory remains as L1 cache.
 *   M-3: The in-memory Map had no cap — a flood of /init calls (with no
 *        corresponding /verify) would consume unbounded memory. Now capped
 *        at MAX_INMEMORY_SESSIONS with LRU eviction.
 */

import { db } from '@/lib/db'
import {
  x25519Generate,
  x25519SharedSecret,
  hkdfSha256,
  hex,
  utf8,
  secureRandomHex,
} from '@/lib/crypto-server'
import { appendAudit } from '@/lib/audit'
import { getRedis } from '@/lib/cache/redis-cache'
import { logger } from '@/lib/logger'

export interface SessionInit {
  sessionId: string
  challenge: string       // hex
  backendPubKey: string   // hex X25519 public key
  expiresAt: Date
}

// ---------------------------------------------------------------------------
// In-memory L1 cache for session private keys
// SECURITY FIX (M-3): Capped at MAX_INMEMORY_SESSIONS with LRU eviction.
// ---------------------------------------------------------------------------

const MAX_INMEMORY_SESSIONS = 10_000 // Cap to prevent memory exhaustion DoS

interface SessionEntry {
  privateKey: Uint8Array
  createdAt: number
  expiresAt: number
  // Track last access for LRU eviction
  lastAccessedAt: number
}

const activeSessions = new Map<string, SessionEntry>()

/**
 * Insert/Update a session entry, evicting the least-recently-used entry
 * if we've hit the cap. The Map preserves insertion order, so the first
 * entry is the oldest (LRU candidate).
 */
function setSessionEntry(sessionId: string, entry: SessionEntry): void {
  // If we're at capacity, evict the LRU entry
  if (activeSessions.size >= MAX_INMEMORY_SESSIONS && !activeSessions.has(sessionId)) {
    // Find the LRU entry (smallest lastAccessedAt)
    let lruKey: string | null = null
    let lruTime = Infinity
    for (const [key, val] of activeSessions) {
      if (val.lastAccessedAt < lruTime) {
        lruTime = val.lastAccessedAt
        lruKey = key
      }
    }
    if (lruKey) {
      activeSessions.delete(lruKey)
      logger.warn({ evictedSessionId: lruKey }, 'Session LRU eviction — cache at capacity')
    }
  }
  activeSessions.set(sessionId, entry)
}

/**
 * Get a session entry, updating lastAccessedAt for LRU tracking.
 */
function getSessionEntry(sessionId: string): SessionEntry | null {
  const entry = activeSessions.get(sessionId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    activeSessions.delete(sessionId)
    return null
  }
  entry.lastAccessedAt = Date.now()
  return entry
}

// ---------------------------------------------------------------------------
// Consumed session IDs (one-time use enforcement)
// SECURITY FIX (M-2): Also persisted to Redis for multi-instance coordination.
// ---------------------------------------------------------------------------

const CONSUMED_TTL_SEC = 24 * 60 * 60 // 24 hours
const consumedSessionIds = new Map<string, number>()

// Periodic cleanup of expired consumed-session IDs (every 5 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [id, expiresAt] of consumedSessionIds) {
    if (expiresAt < now) consumedSessionIds.delete(id)
  }
  // Hard cap to prevent unbounded growth
  if (consumedSessionIds.size > 50_000) {
    const entries = [...consumedSessionIds.entries()].sort((a, b) => a[1] - b[1])
    const toRemove = entries.slice(0, entries.length - 25_000)
    for (const [id] of toRemove) consumedSessionIds.delete(id)
  }
}, 5 * 60 * 1000).unref?.()

export async function initSession(opts: {
  tenantId: string
  flow: 'enroll' | 'authenticate'
  targetUserId?: string
  clientIp?: string
  userAgent?: string
}): Promise<SessionInit> {
  // Generate ephemeral X25519 keypair for this session
  const keypair = x25519Generate()
  const challenge = secureRandomHex(32)

  // Session expires in 60 seconds (configurable per-tenant)
  const tenant = await db.tenant.findUnique({ where: { id: opts.tenantId } })
  const ttl = tenant?.maxSessionAgeSec ?? 60
  const expiresAt = new Date(Date.now() + ttl * 1000)

  const session = await db.session.create({
    data: {
      tenantId: opts.tenantId,
      challenge,
      backendPubKey: hex.encode(keypair.publicKey),
      flow: opts.flow,
      targetUserId: opts.targetUserId,
      clientIp: opts.clientIp,
      userAgent: (opts.userAgent ?? '').slice(0, 256),
      state: 'pending',
      expiresAt,
    },
  })

  // Store the private key in-memory (L1) — NEVER persisted to DB
  const now = Date.now()
  setSessionEntry(session.id, {
    privateKey: keypair.privateKey,
    createdAt: now,
    expiresAt: expiresAt.getTime(),
    lastAccessedAt: now,
  })

  // SECURITY FIX (M-2): Also store in Redis (L2) so other instances can verify.
  // The private key is short-lived (60s TTL) and encrypted in transit via TLS.
  // We store it as hex so it serializes cleanly.
  const redis = await getRedis()
  if (redis) {
    try {
      const redisKey = `session:privkey:${session.id}`
      await redis.setEx(
        redisKey,
        ttl + 5, // Small buffer to account for clock skew
        hex.encode(keypair.privateKey),
      )
    } catch (e) {
      // Non-fatal — L1 cache still works for this instance
      logger.warn({ error: e, sessionId: session.id }, 'Failed to store session key in Redis')
    }
  }

  // Schedule in-memory cleanup
  setTimeout(() => {
    activeSessions.delete(session.id)
  }, ttl * 1000).unref?.()

  // SECURITY FIX (load-test): Fire audit log asynchronously (fire-and-forget)
  // for session.init — this is a non-critical audit event that doesn't need
  // to block the response. The audit entry will be written shortly after
  // the response is sent. This prevents SQLite write-lock contention under
  // concurrent load (SQLite is single-writer — holding the lock for audit
  // serialization blocks all other requests).
  // In production with PostgreSQL, this can be changed back to `await`.
  void appendAudit({
    tenantId: opts.tenantId,
    eventType: 'session.init',
    payload: { sessionId: session.id, flow: opts.flow },
    actorIp: opts.clientIp,
  }).catch((e) => {
    logger.warn({ error: e, sessionId: session.id }, 'Failed to append session.init audit (non-blocking)')
  })

  return {
    sessionId: session.id,
    challenge,
    backendPubKey: hex.encode(keypair.publicKey),
    expiresAt,
  }
}

export async function getSessionPrivateKey(sessionId: string): Promise<Uint8Array | null> {
  // L1: In-memory
  const entry = getSessionEntry(sessionId)
  if (entry) return entry.privateKey

  // L2: Redis (multi-instance coordination — SECURITY FIX M-2)
  const redis = await getRedis()
  if (redis) {
    try {
      const redisKey = `session:privkey:${sessionId}`
      const hexKey = await redis.get(redisKey)
      if (hexKey) {
        const privateKey = hex.decode(hexKey)
        // Populate L1 for subsequent lookups on this instance
        const now = Date.now()
        // We don't know the exact expiry from Redis, so use a conservative 60s
        setSessionEntry(sessionId, {
          privateKey,
          createdAt: now,
          expiresAt: now + 60_000,
          lastAccessedAt: now,
        })
        return privateKey
      }
    } catch (e) {
      logger.warn({ error: e, sessionId }, 'Failed to fetch session key from Redis')
    }
  }

  return null
}

/**
 * Derive the AES-256 session key from the ECDH shared secret.
 * Used to decrypt the SDK's encrypted payload.
 *
 *   sessionKey = HKDF(ECDH(myPriv, theirPub), salt=challenge, info='veriface-session-v1')
 */
export function deriveSessionKey(
  backendPrivateKey: Uint8Array,
  sdkPublicKey: Uint8Array,
  challenge: string,
): Uint8Array {
  const shared = x25519SharedSecret(backendPrivateKey, sdkPublicKey)
  return hkdfSha256(
    shared,
    utf8.encode(challenge),
    utf8.encode('veriface-session-v1'),
    32,
  )
}

/**
 * Mark session as completed (success or failure) and clean up.
 * Once completed, the session CANNOT be reused — this is the
 * replay protection mechanism. Any subsequent /verify call with
 * the same sessionId will fail with SESSION_NOT_PENDING.
 */
export async function completeSession(
  sessionId: string,
  state: 'success' | 'failed' | 'expired',
  result?: Record<string, unknown>,
): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { state, result: result ? JSON.stringify(result) : null },
  })
  activeSessions.delete(sessionId)

  // SECURITY FIX (M-2): Also remove from Redis and mark as consumed in Redis
  const redis = await getRedis()
  if (redis) {
    try {
      await redis.del(`session:privkey:${sessionId}`)
      await redis.setEx(
        `session:consumed:${sessionId}`,
        CONSUMED_TTL_SEC,
        String(Date.now()),
      )
    } catch (e) {
      logger.warn({ error: e, sessionId }, 'Failed to clean up Redis session state')
    }
  }

  // Track consumed session IDs for 24h (defense in depth — even if DB
  // is reset, we still reject recently-used session IDs)
  consumedSessionIds.set(sessionId, Date.now() + CONSUMED_TTL_SEC * 1000)
  // Cleanup old entries
  if (consumedSessionIds.size > 10_000) {
    const now = Date.now()
    for (const [id, expiresAt] of consumedSessionIds) {
      if (expiresAt < now) consumedSessionIds.delete(id)
    }
  }
}

export async function isSessionConsumed(sessionId: string): Promise<boolean> {
  // L1: in-memory
  if (consumedSessionIds.has(sessionId)) return true

  // L2: Redis (multi-instance coordination — SECURITY FIX M-2)
  const redis = await getRedis()
  if (redis) {
    try {
      const consumed = await redis.get(`session:consumed:${sessionId}`)
      if (consumed) {
        // Populate L1 for future lookups
        consumedSessionIds.set(sessionId, Date.now() + CONSUMED_TTL_SEC * 1000)
        return true
      }
    } catch {
      // Ignore — fall through to false
    }
  }

  return false
}

/**
 * Get a session by ID, verifying it belongs to the claimed tenant
 * and is still in a verifiable state.
 */
export async function getSessionForVerification(
  sessionId: string,
  tenantId: string,
): Promise<{
  valid: boolean
  session?: Awaited<ReturnType<typeof db.session.findUnique>>
  reason?: string
}> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
  })

  if (!session) return { valid: false, reason: 'SESSION_NOT_FOUND' }
  if (session.tenantId !== tenantId) return { valid: false, reason: 'TENANT_MISMATCH' }
  if (session.state !== 'pending') return { valid: false, reason: `SESSION_${session.state.toUpperCase()}` }
  if (session.expiresAt < new Date()) {
    await db.session.update({ where: { id: sessionId }, data: { state: 'expired' } })
    return { valid: false, reason: 'SESSION_EXPIRED' }
  }

  return { valid: true, session: session as any }
}
