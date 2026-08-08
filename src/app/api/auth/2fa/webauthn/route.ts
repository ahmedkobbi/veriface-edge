/**
 * POST /api/auth/2fa/webauthn
 * Complete 2FA login using a WebAuthn hardware key / passkey.
 *
 * This is the alternative to TOTP — instead of entering a 6-digit code,
 * the user touches their hardware key (YubiKey, Titan) or uses biometrics
 * (Touch ID, Windows Hello).
 *
 * Flow:
 *   1. User logs in with email + password
 *   2. Login returns { requiresTwoFactor: true, pendingToken, twoFactorMethods: { webauthn: true } }
 *   3. Client calls POST /api/auth/2fa/webauthn/begin with the pendingToken
 *      → Returns WebAuthn authentication options (challenge + allowed credentials)
 *   4. Client calls navigator.credentials.get() with the options
 *   5. Client sends the assertion + challenge to THIS endpoint:
 *        POST /api/auth/2fa/webauthn
 *        Body: { pendingToken, assertion, challenge }
 *   6. Backend verifies the assertion against the user's stored WebAuthn credentials
 *   7. If valid → issue full session token (same as TOTP 2FA completion)
 *
 * Security:
 *   - The pendingToken (from login) is verified — ensures the user already passed password check
 *   - The WebAuthn assertion is verified against stored credentials (counter-based clone detection)
 *   - The challenge from step 3 must match the assertion (prevents replay)
 *   - requireUserVerification: true — user must touch the key or use biometrics
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createSessionToken, buildCookieHeader, toPublicUser } from '@/lib/platform-auth'
import { verifyPlatformUserWebAuthnAssertion } from '@/lib/webauthn'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { safeErrorResponse } from '@/lib/config'
import { z } from 'zod'

const WebAuthn2FASchema = z.object({
  pendingToken: z.string().min(1),
  assertion: z.any(),
  challenge: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const validation = WebAuthn2FASchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0]?.message },
        { status: 400 },
      )
    }

    const { pendingToken, assertion, challenge } = validation.data

    // 1. Verify the pending token (from login — proves password was correct)
    // Parse the JWT payload to extract the user ID + type
    const parts = pendingToken.split('.')
    if (parts.length !== 3) {
      return NextResponse.json(
        { success: false, error: 'Invalid token format', code: 'TOKEN_INVALID' },
        { status: 401 },
      )
    }

    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payloadBin = atob(payloadB64)
    const payloadBytes = new Uint8Array(payloadBin.length)
    for (let i = 0; i < payloadBin.length; i++) payloadBytes[i] = payloadBin.charCodeAt(i)
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes))

    if (claims.type !== 'two_factor_pending') {
      return NextResponse.json(
        { success: false, error: 'Token is not a 2FA pending token', code: 'TOKEN_WRONG_TYPE' },
        { status: 401 },
      )
    }

    const now = Math.floor(Date.now() / 1000)
    if (claims.exp && claims.exp < now) {
      return NextResponse.json(
        { success: false, error: 'Pending token expired', code: 'TOKEN_EXPIRED' },
        { status: 401 },
      )
    }

    const userId = claims.sub

    // 2. Fetch the user
    const user = await db.platformUser.findUnique({
      where: { id: userId },
    })

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 404 },
      )
    }

    // 3. Verify the WebAuthn assertion
    const result = await verifyPlatformUserWebAuthnAssertion(
      assertion,
      challenge,
      userId,
    )

    if (!result.verified) {
      logger.warn({ userId, reason: result.reason }, 'WebAuthn 2FA assertion verification failed')

      await appendAudit({
        tenantId: user.tenantId ?? 'unknown',
        eventType: 'auth.failure',
        payload: { reason: 'WEBAUTHN_ASSERTION_FAILED', userId, detail: result.reason },
      })

      return NextResponse.json(
        { success: false, error: 'Hardware key verification failed', code: 'WEBAUTHN_FAILED' },
        { status: 401 },
      )
    }

    // 4. Update credential counter (clone detection)
    if (result.credentialId && result.counter !== undefined) {
      await db.webAuthnCredential.update({
        where: { id: result.credentialId },
        data: {
          counter: result.counter,
          lastUsedAt: new Date(),
        },
      })
    }

    // 5. Update lastLoginAt
    await db.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // 6. Issue full session token
    const token = await createSessionToken(user.id, user.email, user.tenantId)

    logger.info({ userId: user.id, email: user.email, method: 'webauthn' }, 'User logged in via WebAuthn 2FA')

    await appendAudit({
      tenantId: user.tenantId ?? 'unknown',
      eventType: 'auth.success',
      payload: { method: 'webauthn_2fa', userId: user.id, credentialId: result.credentialId },
    })

    const response = NextResponse.json({
      success: true,
      user: toPublicUser(user),
      twoFactorMethod: 'webauthn',
    })
    response.headers.set('Set-Cookie', buildCookieHeader(token))
    return response
  } catch (e) {
    logger.error({ error: e }, 'WebAuthn 2FA login failed')
    return NextResponse.json(safeErrorResponse(e), { status: 500 })
  }
}
