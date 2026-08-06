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

export interface SessionInit {
  sessionId: string
  challenge: string       // hex
  backendPubKey: string   // hex X25519 public key
  expiresAt: Date
}

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

  // Store the private key in-memory only (NEVER persisted)
  // The session verifier will use this to derive the ECDH shared secret
  activeSessions.set(session.id, {
    privateKey: keypair.privateKey,
    createdAt: Date.now(),
    expiresAt: expiresAt.getTime(),
  })

  // Schedule cleanup
  setTimeout(() => {
    activeSessions.delete(session.id)
  }, ttl * 1000)

  await appendAudit({
    tenantId: opts.tenantId,
    eventType: 'session.init',
    payload: { sessionId: session.id, flow: opts.flow },
    actorIp: opts.clientIp,
  })

  return {
    sessionId: session.id,
    challenge,
    backendPubKey: hex.encode(keypair.publicKey),
    expiresAt,
  }
}

// In-memory store of ephemeral session private keys (NEVER persisted).
// On a multi-instance deployment, use Redis with TTL — but for our
// purpose, in-memory is sufficient and more secure (no network exposure).
const activeSessions = new Map<string, {
  privateKey: Uint8Array
  createdAt: number
  expiresAt: number
}>()

export function getSessionPrivateKey(sessionId: string): Uint8Array | null {
  const entry = activeSessions.get(sessionId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    activeSessions.delete(sessionId)
    return null
  }
  return entry.privateKey
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
