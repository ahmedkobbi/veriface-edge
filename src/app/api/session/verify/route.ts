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
import { incrementMonthlyUsage, getPlan } from '@/lib/rate-limit-tiers'
import { notifyBillingThreshold, notifyBillingLimitReached, notifyInjectionDetected, getTenantAdminRecipient } from '@/lib/email-notifications'
import { getExperimentValue, recordOutcome, type ExperimentOutcomeType } from '@/lib/experiments'

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

  const authResult = await requireApiKey(req, 'session:verify', { billable: true })
  if (!authResult.ok) return authResult.response
  const tenantId = authResult.auth.tenantId!

  // SECURITY FIX (B-04): Idempotency check moved to AFTER signature verification.
  // Previously, the idempotency check ran before verifyRequestSignature —
  // an attacker who captured a valid signed request could replay it WITHOUT
  // the signature headers and still get the cached response (containing the
  // auth token). Now: the signature is verified first, then we check for a
  // cached idempotent response.
  const idempotencyKey = extractIdempotencyKey(req)

  try {
    const rawBodyString = JSON.stringify(await req.json())

    // Verify HMAC request signature (replay protection)
    // SECURITY FIX (C-2): Use the tenant's webhookSecret as the HMAC key
    // instead of the API key plaintext (which is not available — AuthResult
    // only stores the key hash, not the plaintext).
    //
    // The webhookSecret is a per-tenant HMAC secret known to both the
    // backend and the SDK (it's returned at tenant creation). Using it
    // for request signing provides:
    //   - Replay protection (timestamp + nonce + body in signature)
    //   - Per-tenant key isolation (each tenant has a unique secret)
    //   - No need to store the API key plaintext in memory
    const tenantForSig = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { webhookSecret: true },
    })
    const hmacKey = tenantForSig?.webhookSecret ?? ''
    const sigResult = await verifyRequestSignature(req, hmacKey, rawBodyString)
    if (!sigResult.valid) {
      logger.warn({ tenantId, reason: sigResult.reason }, 'Request signature verification failed')
      return NextResponse.json(
        { success: false, code: 'INVALID_SIGNATURE', error: `Signature verification failed: ${sigResult.reason}` },
        { status: 401 },
      )
    }

    // SECURITY FIX (B-04): Idempotency check runs AFTER signature verification.
    // Only return the cached response if the caller has a valid signature.
    if (idempotencyKey) {
      const cached = getIdempotentResponse(tenantId, '/api/session/verify', idempotencyKey)
      if (cached) {
        logger.info({ tenantId, idempotencyKey }, 'Returning cached idempotent response (post-sig-verify)')
        return NextResponse.json(cached.body, { status: cached.status })
      }
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
    // SECURITY FIX (M-2): isSessionConsumed is now async (checks Redis L2)
    if (await isSessionConsumed(sessionId)) {
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
    // SECURITY FIX (C-1): Verify the JWT against the TENANT's stored signingPubKey,
    // NOT against a key extracted from the unverified JWT payload.
    //
    // Previously, the code extracted `proof.sdk_pubkey` from the unverified JWT
    // and used it to verify the signature — allowing an attacker to sign with
    // their own key and have the server verify against that same key.
    //
    // The SDK must sign the JWT with the tenant's Ed25519 signing private key
    // (provided at tenant creation). The backend verifies against the stored
    // signingPubKey. For post-quantum hybrid mode, the backend also verifies
    // the ML-DSA-87 signature against pqSigningPubKey.
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) {
      return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 403 })
    }

    if (!tenant.signingPubKey) {
      return NextResponse.json(
        { success: false, code: 'TENANT_CONFIG_ERROR', error: 'Tenant has no signing public key configured' },
        { status: 500 },
      )
    }

    // Verify the JWT signature using the TENANT's stored Ed25519 public key
    const claims = await verifyJwtSignature(jwt, tenant.signingPubKey)
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

      // Record experiment outcome: injection detected
      if (externalUserId) {
        try {
          const expResult = await getExperimentValue(tenantId, 'liveness_threshold', externalUserId, 0.78)
          if (expResult.experimentId && expResult.variant) {
            void recordOutcome({
              tenantId,
              experimentId: expResult.experimentId,
              variant: expResult.variant,
              externalUserId,
              outcome: 'injection.detected',
            }).catch((e) => logger.warn({ error: e }, 'Failed to record experiment outcome'))
          }
        } catch (e) {
          logger.warn({ error: e, tenantId }, 'Experiment lookup failed for injection outcome')
        }
      }

      // Fire injection-detected email to tenant admin (best-effort, non-blocking)
      try {
        const admin = await getTenantAdminRecipient(tenantId)
        if (admin) {
          void notifyInjectionDetected({
            tenantId,
            to: admin.email,
            userId: admin.userId,
            name: admin.name ?? undefined,
            reasons: antiInjection.failureReasons.join(', '),
            ip: clientIp,
            sessionId,
          })
        }
      } catch (e) {
        logger.warn({ error: e, tenantId }, 'Failed to enqueue injection-detected email')
      }

      return NextResponse.json(
        { success: false, code: 'INJECTION_SUSPECTED', error: `Anti-injection failed: ${antiInjection.failureReasons.join(', ')}` },
        { status: 403 },
      )
    }

    // 5. Liveness threshold check
    // Order of precedence: active experiment variant > tenant override > global default
    let threshold = tenant.livenessThreshold ?? LIVENESS_THRESHOLD
    let experimentContext: { experimentId: string | null; variant: string | null } = {
      experimentId: null,
      variant: null,
    }

    if (externalUserId) {
      try {
        const expResult = await getExperimentValue(
          tenantId,
          'liveness_threshold',
          externalUserId,
          threshold,
        )
        threshold = expResult.value
        experimentContext = {
          experimentId: expResult.experimentId,
          variant: expResult.variant,
        }
      } catch (e) {
        logger.warn({ error: e, tenantId }, 'Experiment lookup failed (using default threshold)')
      }
    }

    if (liveness.overall < threshold) {
      await appendAudit({
        tenantId,
        eventType: 'auth.failure',
        payload: { sessionId, reason: 'LIVENESS_BELOW_THRESHOLD', score: liveness.overall, threshold, externalUserId },
        actorIp: clientIp,
      })
      await completeSession(sessionId, 'failed', { reason: 'LIVENESS_FAILED', score: liveness.overall })

      // Record experiment outcome (if assigned)
      if (experimentContext.experimentId && experimentContext.variant && externalUserId) {
        void recordOutcome({
          tenantId,
          experimentId: experimentContext.experimentId,
          variant: experimentContext.variant,
          externalUserId,
          outcome: 'liveness.failed',
          livenessScore: liveness.overall,
        }).catch((e) => logger.warn({ error: e }, 'Failed to record experiment outcome'))
      }

      return NextResponse.json(
        { success: false, code: 'LIVENESS_FAILED', error: `Liveness ${liveness.overall.toFixed(3)} < ${threshold}` },
        { status: 403 },
      )
    }

    // 6. Derive session key & decrypt embedding
    // SECURITY FIX (M-2): getSessionPrivateKey is now async (checks Redis L2)
    const backendPriv = await getSessionPrivateKey(sessionId)
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

      // Record experiment outcome: enroll.success
      if (experimentContext.experimentId && experimentContext.variant) {
        void recordOutcome({
          tenantId,
          experimentId: experimentContext.experimentId,
          variant: experimentContext.variant,
          externalUserId,
          outcome: 'enroll.success',
          livenessScore: liveness.overall,
          durationMs: Date.now() - startTime,
        }).catch((e) => logger.warn({ error: e }, 'Failed to record experiment outcome'))
      }

      // Increment monthly usage + fire billing alerts if thresholds crossed
      try {
        const plan = getPlan(tenant.planTier)
        const usage = await incrementMonthlyUsage(tenantId, tenant.planTier)
        if (plan.monthlyLimit > 0) {
          const admin = await getTenantAdminRecipient(tenantId)
          if (admin) {
            if (usage.limitJustCrossed) {
              const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
              void notifyBillingLimitReached({
                tenantId, to: admin.email, userId: admin.userId,
                monthlyLimit: plan.monthlyLimit, planName: plan.displayName,
                resetDate: nextMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              })
            } else if (usage.thresholdJustCrossed) {
              void notifyBillingThreshold({
                tenantId, to: admin.email, userId: admin.userId,
                usedPct: usage.usedPct, currentCount: usage.count,
                monthlyLimit: plan.monthlyLimit, planName: plan.displayName,
              })
            }
          }
        }
      } catch (e) {
        logger.warn({ error: e, tenantId }, 'Failed to increment monthly usage / fire billing alert')
      }
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

        // Record experiment outcome: auth.failure
        if (experimentContext.experimentId && experimentContext.variant) {
          void recordOutcome({
            tenantId,
            experimentId: experimentContext.experimentId,
            variant: experimentContext.variant,
            externalUserId,
            outcome: 'auth.failure',
            cosineSimilarity: result.cosineSimilarity,
            durationMs: Date.now() - startTime,
          }).catch((e) => logger.warn({ error: e }, 'Failed to record experiment outcome'))
        }

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

      // Record experiment outcome: auth.success
      if (experimentContext.experimentId && experimentContext.variant) {
        void recordOutcome({
          tenantId,
          experimentId: experimentContext.experimentId,
          variant: experimentContext.variant,
          externalUserId,
          outcome: 'auth.success',
          livenessScore: liveness.overall,
          cosineSimilarity: result.cosineSimilarity,
          durationMs: Date.now() - startTime,
        }).catch((e) => logger.warn({ error: e }, 'Failed to record experiment outcome'))
      }

      // Increment monthly usage + fire billing alerts if thresholds crossed
      try {
        const plan = getPlan(tenant.planTier)
        const usage = await incrementMonthlyUsage(tenantId, tenant.planTier)
        if (plan.monthlyLimit > 0) {
          const admin = await getTenantAdminRecipient(tenantId)
          if (admin) {
            if (usage.limitJustCrossed) {
              const nextMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
              void notifyBillingLimitReached({
                tenantId, to: admin.email, userId: admin.userId,
                monthlyLimit: plan.monthlyLimit, planName: plan.displayName,
                resetDate: nextMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              })
            } else if (usage.thresholdJustCrossed) {
              void notifyBillingThreshold({
                tenantId, to: admin.email, userId: admin.userId,
                usedPct: usage.usedPct, currentCount: usage.count,
                monthlyLimit: plan.monthlyLimit, planName: plan.displayName,
              })
            }
          }
        }
      } catch (e) {
        logger.warn({ error: e, tenantId }, 'Failed to increment monthly usage / fire billing alert')
      }
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

