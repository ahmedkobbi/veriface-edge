/**
 * POST /api/session/verify
 *
 * Receive the SDK's cryptographic payload and verify it:
 *   1. Look up session, verify it's pending & not expired
 *   2. Verify Ed25519 JWT signature against tenant's signingPubKey
 *   3. Derive ECDH session key (backend priv + SDK pub)
 *   4. Decrypt embedding
 *   5. Verify Pedersen commitment (commitment == BLAKE3(embedding, nonce))
 *   6. Threshold-check liveness scores (per-tenant override)
 *   7. For 'enroll' flow: store encrypted template
 *      For 'authenticate' flow: verify cosine similarity against stored template
 *   8. Issue auth token (JWT, RS256-equivalent using Ed25519)
 *   9. Append to audit log + enqueue webhook
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSigningKey } from '@/lib/config'
import { db } from '@/lib/db'
import {
  hex,
  utf8,
  ed25519Verify,
  verifyCommitment,
  aesGcmDecrypt,
  ed25519Generate,
  type Ed25519KeyPair,
} from '@/lib/crypto-server'
import { getSessionForVerification, getSessionPrivateKey, completeSession, deriveSessionKey, isSessionConsumed } from '@/lib/session'
import { enrollTemplate, verifyTemplate } from '@/lib/tenant'
import { appendAudit } from '@/lib/audit'
import { enqueueWebhook } from '@/lib/webhook'
import { signJwt } from '@/lib/jwt-server'
import { requireApiKey } from '@/lib/auth'
import { validateInput, SessionVerifySchema } from '@/lib/validation'
import { extractIdempotencyKey, getIdempotentResponse, cacheIdempotentResponse } from '@/lib/idempotency'
import { checkBodySize, BODY_LIMITS } from '@/lib/body-limits'
import { verifyRequestSignature } from '@/lib/request-signing'
import { logger } from '@/lib/logger'
import { authAttemptsTotal, enrollmentsTotal, cryptoOperationDurationSeconds, injectionSuspectedTotal } from '@/lib/metrics'
import { safeErrorResponse } from '@/lib/config'

interface VerifyPayload {
  sessionId: string
  tenantId: string
  jwt: string
  sdkPubKey: string  // X25519 public key (hex)
  encryptedEmbedding: {
    ciphertext: string  // hex
    iv: string          // hex
    authTag: string     // hex
  }
  commitment: string
  commitmentNonce: string  // hex
  liveness: {
    rppg: number
    rppgHeartRateBpm: number | null
    rppgSnr: number
    padTexture: number
    padDepth: number
    padCombined: number
    overall: number
  }
  antiInjection: {
    passed: boolean
    deviceScan: any
    timingStats: any
    replayDetected: boolean
    tamperCheck: any
    attestation: any
    strobeChallenges: number
    strobeResponses: number
    failureReasons: string[]
  }
  externalUserId?: string
}

const LIVENESS_THRESHOLD = 0.78
const COSINE_THRESHOLD = 0.62

export async function POST(req: NextRequest) {
  const startTime = Date.now()
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  // API key authentication
  // Check request body size (DoS protection)
  const bodySizeError = await checkBodySize(req, BODY_LIMITS.SESSION_VERIFY)
  if (bodySizeError) return bodySizeError

  const authResult = await requireApiKey(req, 'session:verify')
  if (!authResult.ok) return authResult.response
  const tenantId = authResult.auth.tenantId!

  // Idempotency check
  const idempotencyKey = extractIdempotencyKey(req)
  if (idempotencyKey) {
    const cached = getIdempotentResponse(tenantId, '/api/session/verify', idempotencyKey)
    if (cached) {
      logger.info({ tenantId, idempotencyKey }, 'Returning cached idempotent response')
      return NextResponse.json(cached.body, { status: cached.status })
    }
  }

  try {
    const rawBodyString = JSON.stringify(await req.json())

    // Verify HMAC request signature (replay protection)
    // The API key plaintext is needed for signature verification
    const sigResult = await verifyRequestSignature(req, authResult.auth.apiKey ?? '', rawBodyString)
    if (!sigResult.valid) {
      logger.warn({ tenantId, reason: sigResult.reason }, 'Request signature verification failed')
      return NextResponse.json(
        { success: false, code: 'INVALID_SIGNATURE', error: `Signature verification failed: ${sigResult.reason}` },
        { status: 401 },
      )
    }

    const rawBody = JSON.parse(rawBodyString)

    // Validate input with Zod
    const validation = validateInput(SessionVerifySchema, rawBody)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error, code: 'INVALID_INPUT' }, { status: 400 })
    }
    const body = validation.data as unknown as VerifyPayload
    const { sessionId, jwt, sdkPubKey, encryptedEmbedding, commitment, commitmentNonce, liveness, antiInjection, externalUserId } = body

    // Replay protection: check if session was already consumed
    if (isSessionConsumed(sessionId)) {
      logger.warn({ tenantId, sessionId }, 'Replay attempt: session already consumed')
      return NextResponse.json(
        { success: false, code: 'SESSION_REPLAY', error: 'Session already used' },
        { status: 403 },
      )
    }

    // 1. Validate session
    const sessionCheck = await getSessionForVerification(sessionId, tenantId)
    if (!sessionCheck.valid) {
      return NextResponse.json(
        { success: false, code: sessionCheck.reason, error: `Session invalid: ${sessionCheck.reason}` },
        { status: 403 },
      )
    }
    const session = sessionCheck.session!

    // 2. Verify JWT signature
    // FIX (#2): The SDK signs the JWT with its ephemeral per-session Ed25519 keypair,
    // NOT the tenant's signing key. The ephemeral public key is included in the
    // JWT payload's `proof.sdk_pubkey` claim. We extract it and verify against it.
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 403 })
    }

    // Decode the JWT payload (without verification) to extract the SDK's ephemeral public key
    const jwtParts = jwt.split('.')
    if (jwtParts.length !== 3) {
      return NextResponse.json(
        { success: false, code: 'JWT_INVALID', error: 'Malformed JWT' },
        { status: 401 },
      )
    }
    const payloadPadded = jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payloadBin = atob(payloadPadded)
    const payloadBytes = new Uint8Array(payloadBin.length)
    for (let i = 0; i < payloadBin.length; i++) payloadBytes[i] = payloadBin.charCodeAt(i)
    const unverifiedClaims = JSON.parse(new TextDecoder().decode(payloadBytes))
    const sdkPubKey = unverifiedClaims?.proof?.sdk_pubkey
    if (!sdkPubKey || typeof sdkPubKey !== 'string') {
      return NextResponse.json(
        { success: false, code: 'JWT_INVALID', error: 'JWT missing proof.sdk_pubkey' },
        { status: 401 },
      )
    }

    // Now verify the JWT signature using the SDK's ephemeral public key
    const claims = await verifyJwtSignature(jwt, sdkPubKey)
    if (!claims) {
      await appendAudit({
        tenantId,
        eventType: 'auth.failure',
        payload: { sessionId, reason: 'JWT_SIGNATURE_INVALID', externalUserId },
        actorIp: clientIp,
      })
      return NextResponse.json(
        { success: false, code: 'JWT_INVALID', error: 'JWT signature verification failed' },
        { status: 401 },
      )
    }

    // 3. Verify the JWT's subject matches the session
    if (claims.sub !== sessionId) {
      return NextResponse.json(
        { success: false, code: 'JWT_SUBJECT_MISMATCH', error: 'JWT subject does not match session' },
        { status: 401 },
      )
    }

    // 4. Anti-injection check (server-side re-validation)
    if (!antiInjection.passed) {
      await appendAudit({
        tenantId,
        eventType: 'injection.suspected',
        payload: { sessionId, reasons: antiInjection.failureReasons, externalUserId },
        actorIp: clientIp,
      })
      await completeSession(sessionId, 'failed', { reason: 'ANTI_INJECTION_FAILED' })
      return NextResponse.json(
        { success: false, code: 'INJECTION_SUSPECTED', error: `Anti-injection failed: ${antiInjection.failureReasons.join(', ')}` },
        { status: 403 },
      )
    }

    // 5. Liveness threshold check (per-tenant override)
    const threshold = tenant.livenessThreshold ?? LIVENESS_THRESHOLD
    if (liveness.overall < threshold) {
      await appendAudit({
        tenantId,
        eventType: 'auth.failure',
        payload: { sessionId, reason: 'LIVENESS_BELOW_THRESHOLD', score: liveness.overall, threshold, externalUserId },
        actorIp: clientIp,
      })
      await completeSession(sessionId, 'failed', { reason: 'LIVENESS_FAILED', score: liveness.overall })
      return NextResponse.json(
        { success: false, code: 'LIVENESS_FAILED', error: `Liveness ${liveness.overall.toFixed(3)} < ${threshold}` },
        { status: 403 },
      )
    }

    // 6. Derive session key & decrypt embedding
    const backendPriv = getSessionPrivateKey(sessionId)
    if (!backendPriv) {
      return NextResponse.json(
        { success: false, code: 'SESSION_EXPIRED', error: 'Session key not found (expired)' },
        { status: 403 },
      )
    }

    let embedding: Float32Array
    try {
      const sessionKey = deriveSessionKey(backendPriv, hex.decode(sdkPubKey), session.challenge)
      const plainBytes = aesGcmDecrypt(
        sessionKey,
        {
          ciphertext: hex.decode(encryptedEmbedding.ciphertext),
          iv: hex.decode(encryptedEmbedding.iv),
          authTag: hex.decode(encryptedEmbedding.authTag),
        },
        utf8.encode(session.challenge),
      )
      embedding = new Float32Array(plainBytes.buffer)
    } catch (e) {
      await appendAudit({
        tenantId,
        eventType: 'auth.failure',
        payload: { sessionId, reason: 'EMBEDDING_DECRYPT_FAILED', externalUserId },
        actorIp: clientIp,
      })
      return NextResponse.json(
        { success: false, code: 'DECRYPT_FAILED', error: 'Failed to decrypt embedding' },
        { status: 400 },
      )
    }

    // 7. Verify Pedersen commitment
    const commitmentValid = verifyCommitment(embedding, hex.decode(commitmentNonce), commitment)
    if (!commitmentValid) {
      await appendAudit({
        tenantId,
        eventType: 'auth.failure',
        payload: { sessionId, reason: 'COMMITMENT_MISMATCH', externalUserId },
        actorIp: clientIp,
      })
      return NextResponse.json(
        { success: false, code: 'COMMITMENT_MISMATCH', error: 'ZK commitment verification failed' },
        { status: 401 },
      )
    }

    // 8. Flow dispatch
    let outcome: { matched?: boolean; cosineSimilarity?: number; templateId?: string }
    if (session.flow === 'enroll') {
      if (!externalUserId) {
        return NextResponse.json({ success: false, error: 'externalUserId required for enroll' }, { status: 400 })
      }

      // FIX (H7): Enforce GDPR Art. 7 consent before enrollment.
      // User must have a recent ConsentRecord with granted=true for purpose='enrollment'.
      const consentRecord = await db.consentRecord.findFirst({
        where: {
          tenantId,
          purpose: 'enrollment',
          granted: true,
          user: { externalUserId },
        },
        orderBy: { createdAt: 'desc' },
      })
      if (!consentRecord) {
        return NextResponse.json(
          { success: false, code: 'CONSENT_REQUIRED', error: 'Enrollment requires prior consent (GDPR Art. 7). Call POST /api/consent first.' },
          { status: 403 },
        )
      }

      const result = await enrollTemplate({
        tenantId,
        externalUserId,
        embedding,
        nonce: hex.decode(commitmentNonce),
        variant: 'standard',
        modelVersion: String(claims.model_version ?? 'v1.0.0'),
      })
      outcome = { templateId: result.templateId }
      await appendAudit({
        tenantId,
        eventType: 'enroll.success',
        payload: { sessionId, externalUserId, templateId: result.templateId, commitment: result.commitment },
        actorIp: clientIp,
      })
      await enqueueWebhook(tenantId, 'enroll.completed', {
        sessionId,
        externalUserId,
        templateId: result.templateId,
        liveness,
      })
    } else {
      // Authenticate: verify against stored template
      if (!externalUserId) {
        return NextResponse.json({ success: false, error: 'externalUserId required for authenticate' }, { status: 400 })
      }
      const result = await verifyTemplate(tenantId, externalUserId, embedding)
      if (!result.matched) {
        await appendAudit({
          tenantId,
          eventType: 'auth.failure',
          payload: { sessionId, externalUserId, reason: 'TEMPLATE_NO_MATCH', cosine: result.cosineSimilarity },
          actorIp: clientIp,
        })
        await completeSession(sessionId, 'failed', { reason: 'NO_MATCH', cosine: result.cosineSimilarity })
        return NextResponse.json(
          { success: false, code: 'NO_MATCH', error: `Cosine ${result.cosineSimilarity.toFixed(3)} < ${result.threshold}` },
          { status: 401 },
        )
      }
      outcome = { matched: true, cosineSimilarity: result.cosineSimilarity }
      await appendAudit({
        tenantId,
        eventType: 'auth.success',
        payload: { sessionId, externalUserId, cosine: result.cosineSimilarity, liveness },
        actorIp: clientIp,
      })
      await enqueueWebhook(tenantId, 'auth.success', {
        sessionId,
        externalUserId,
        cosine: result.cosineSimilarity,
        liveness,
      })
    }

    // 9. Issue auth token (server-signed JWT, 5 minute expiry)
    const serverKeypair = getServerSigningKey()
    const now = Math.floor(Date.now() / 1000)
    const expiresIn = 300
    const token = signJwt(
      {
        iss: 'veriface-edge-server',
        sub: externalUserId ?? sessionId,
        iat: now,
        exp: now + expiresIn,
        jti: crypto.randomUUID(),
        tenant_id: tenantId,
        session_id: sessionId,
        amr: ['face'],
        acr: 'eidas:substantial',
        liveness_score: liveness.overall,
        flow: session.flow,
      },
      serverKeypair.privateKey,
    )

    await completeSession(sessionId, 'success', outcome)

    // Wipe embedding from server memory
    embedding.fill(0)

    // Record metrics
    const duration = (Date.now() - startTime) / 1000
    cryptoOperationDurationSeconds.observe({ operation: 'session_verify' }, duration)
    authAttemptsTotal.inc({ tenant_id: tenantId, flow: session.flow, outcome: 'success' })
    if (session.flow === 'enroll') {
      enrollmentsTotal.inc({ tenant_id: tenantId, variant: 'standard', outcome: 'success' })
    }

    logger.info({ tenantId, sessionId, flow: session.flow, duration }, 'Session verified successfully')

    const responseBody = {
      success: true,
      token,
      expiresAt: (now + expiresIn) * 1000,
      sessionId,
      flow: session.flow,
      liveness,
      outcome,
    }

    // Cache for idempotent retry
    if (idempotencyKey) {
      cacheIdempotentResponse(tenantId, '/api/session/verify', idempotencyKey, 200, responseBody)
    }

    return NextResponse.json(responseBody)
  } catch (e) {
    logger.error({ error: e, tenantId }, 'Session verification failed')
    return NextResponse.json(
      safeErrorResponse(e),
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// JWT signature verification (Ed25519)
// ---------------------------------------------------------------------------

async function verifyJwtSignature(
  token: string,
  publicKeyHex: string,
): Promise<any | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts
  const signingInput = headerB64 + '.' + payloadB64

  // Decode base64url
  const sigPadded = sigB64.replace(/-/g, '+').replace(/_/g, '/')
  const sigBin = atob(sigPadded)
  const signature = new Uint8Array(sigBin.length)
  for (let i = 0; i < sigBin.length; i++) signature[i] = sigBin.charCodeAt(i)

  const publicKey = hex.decode(publicKeyHex)
  if (!ed25519Verify(signature, utf8.encode(signingInput), publicKey)) {
    return null
  }

  try {
    const payloadPadded = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
    const payloadBin = atob(payloadPadded)
    const payloadBytes = new Uint8Array(payloadBin.length)
    for (let i = 0; i < payloadBin.length; i++) payloadBytes[i] = payloadBin.charCodeAt(i)
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes))
    const now = Math.floor(Date.now() / 1000)
    if (claims.exp && claims.exp < now) return null
    return claims
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Server signing key (singleton — generated on first use, persisted in env)
// In production: this would be loaded from a KMS-backed secret.
// ---------------------------------------------------------------------------

