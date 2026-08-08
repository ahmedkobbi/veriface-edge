/**
 * POST /api/session/sign
 *
 * Server-side JWT signing proxy (S-02 fix).
 *
 * The SDK sends the unsigned JWT payload (header + claims). The server:
 *   1. Authenticates the request (API key with session:verify scope)
 *   2. Verifies the session is valid, pending, and belongs to the tenant
 *   3. Decrypts the tenant's Ed25519 private key (in-memory only)
 *   4. Signs the JWT with the tenant's private key
 *   5. Returns the signed JWT to the SDK
 *
 * The SDK then includes this signed JWT in the /api/session/verify request.
 *
 * SECURITY:
 *   - The private key NEVER leaves the server (encrypted at rest, decrypted in-memory)
 *   - The SDK never sees the private key — eliminates XSS/reverse-engineering risk
 *   - The session must be valid + pending (prevents pre-signing attacks)
 *   - The JWT claims are validated server-side (tenant_id, session_id match)
 *   - Rate limited (same scope as session:verify)
 *
 * Why this is better than returning the private key to the SDK:
 *   - Browser: the key would be in JS memory (XSS-extractable)
 *   - Mobile: the key would be in the app binary (reverse-engineerable)
 *   - This proxy: the key is in server memory only, never serialized to the client
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/auth'
import { getSessionForVerification } from '@/lib/session'
import { getTenantSigningPrivateKey } from '@/lib/tenant'
import { ed25519Sign, hex, utf8, sha256Hex } from '@/lib/crypto-server'
import { appendAudit } from '@/lib/audit'
import { checkBodySize, BODY_LIMITS } from '@/lib/body-limits'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const SignSchema = z.object({
  sessionId: z.string().min(1).max(100),
  header: z.object({
    alg: z.literal('EdDSA'),
    typ: z.literal('JWT'),
  }),
  payload: z.object({
    iss: z.string(),
    sub: z.string(),  // sessionId
    iat: z.number().int(),
    exp: z.number().int(),
    jti: z.string(),
    tenant_id: z.string(),
    flow: z.enum(['enroll', 'authenticate']),
    external_user_id: z.string().optional(),
    commitment: z.string(),
    liveness: z.record(z.string(), z.any()),
    anti_injection: z.record(z.string(), z.any()),
    model_version: z.string(),
    sdk_version: z.string(),
  }).passthrough(),  // Allow extra fields (liveness scores, etc.)
})

export async function POST(req: NextRequest) {
  // Check body size
  const bodySizeError = await checkBodySize(req, BODY_LIMITS.SESSION_VERIFY)
  if (bodySizeError) return bodySizeError

  // Authenticate with API key
  const authResult = await requireApiKey(req, 'session:verify')
  if (!authResult.ok) return authResult.response
  const tenantId = authResult.auth.tenantId!

  try {
    const body = await req.json()
    const validation = SignSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0]?.message, code: 'INVALID_INPUT' },
        { status: 400 },
      )
    }

    const { sessionId, header, payload } = validation.data

    // 1. Verify the session is valid + pending + belongs to this tenant
    const sessionCheck = await getSessionForVerification(sessionId, tenantId)
    if (!sessionCheck.valid) {
      logger.warn({ tenantId, sessionId, reason: sessionCheck.reason }, 'Session sign: invalid session')
      return NextResponse.json(
        { success: false, code: sessionCheck.reason, error: `Session invalid: ${sessionCheck.reason}` },
        { status: 403 },
      )
    }

    // 2. Verify the JWT payload's session ID matches the actual session
    if (payload.sub !== sessionId) {
      logger.warn({ tenantId, sessionId, payloadSub: payload.sub }, 'Session sign: subject mismatch')
      return NextResponse.json(
        { success: false, code: 'JWT_SUBJECT_MISMATCH', error: 'JWT subject must match sessionId' },
        { status: 400 },
      )
    }

    // 3. Verify the JWT payload's tenant_id matches the authenticated tenant
    if (payload.tenant_id !== tenantId) {
      logger.warn({ tenantId, payloadTenantId: payload.tenant_id }, 'Session sign: tenant mismatch')
      return NextResponse.json(
        { success: false, code: 'TENANT_MISMATCH', error: 'JWT tenant_id must match authenticated tenant' },
        { status: 403 },
      )
    }

    // 4. Verify the JWT hasn't expired (check exp claim)
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) {
      return NextResponse.json(
        { success: false, code: 'JWT_EXPIRED', error: 'JWT payload has already expired' },
        { status: 400 },
      )
    }

    // 5. Verify the JWT exp is not too far in the future (max 5 minutes)
    if (payload.exp > now + 300) {
      return NextResponse.json(
        { success: false, code: 'JWT_EXP_TOO_FAR', error: 'JWT exp must be within 5 minutes' },
        { status: 400 },
      )
    }

    // 6. Decrypt the tenant's signing private key (in-memory only)
    const privateKey = await getTenantSigningPrivateKey(tenantId)
    if (!privateKey) {
      logger.error({ tenantId }, 'Session sign: no signing private key for tenant')
      return NextResponse.json(
        { success: false, code: 'NO_SIGNING_KEY', error: 'Tenant has no signing key configured' },
        { status: 500 },
      )
    }

    // 7. Construct the signing input (header.payload in base64url)
    const headerJson = JSON.stringify(header)
    const payloadJson = JSON.stringify(payload)
    const headerB64 = Buffer.from(headerJson, 'utf-8').toString('base64url')
    const payloadB64 = Buffer.from(payloadJson, 'utf-8').toString('base64url')
    const signingInput = `${headerB64}.${payloadB64}`

    // 8. Sign with the tenant's Ed25519 private key
    const signature = ed25519Sign(utf8.encode(signingInput), privateKey)

    // 9. Wipe the private key from memory
    privateKey.fill(0)

    // 10. Construct the final JWT
    const sigB64 = Buffer.from(signature).toString('base64url')
    const jwt = `${signingInput}.${sigB64}`

    // 11. Audit the signing event (without the JWT itself — it's a secret)
    void appendAudit({
      tenantId,
      eventType: 'session.verify.start',
      payload: { sessionId, jti: payload.jti },
      actorIp: authResult.ip,
      apiKeyId: authResult.auth.apiKeyId,
    }).catch(() => {})

    logger.info({ tenantId, sessionId }, 'Session JWT signed server-side')

    return NextResponse.json({
      success: true,
      jwt,
    })
  } catch (e) {
    logger.error({ error: e, tenantId }, 'Session sign failed')
    return NextResponse.json(
      { success: false, error: 'Signing failed', code: 'SIGN_FAILED' },
      { status: 500 },
    )
  }
}
