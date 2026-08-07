/**
 * POST /api/webauthn/register/begin
 * Begin FIDO2/WebAuthn credential registration.
 * Uses @simplewebauthn/server for full attestation verification.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { secureRandomHex } from '@/lib/crypto-server'
import { beginWebAuthnRegistration } from '@/lib/webauthn'
import { validateInput, WebAuthnRegisterBeginSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { safeErrorResponse } from '@/lib/config'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  const body = await req.json()
  const validation = validateInput(WebAuthnRegisterBeginSchema, body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }
  const { externalUserId, deviceType } = validation.data

  try {
    const { options, userId } = await beginWebAuthnRegistration(
      authResult.auth.tenantId!,
      externalUserId,
      deviceType,
    )

    // Store challenge in session
    const challenge = options.challenge
    const session = await db.session.create({
      data: {
        tenantId: authResult.auth.tenantId!,
        challenge,
        backendPubKey: 'webauthn-register',
        flow: 'webauthn_enroll',
        targetUserId: userId,
        clientIp: authResult.ip,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    })

    logger.info({ tenantId: authResult.auth.tenantId, sessionId: session.id, externalUserId }, 'WebAuthn registration started')

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      options,
    })
  } catch (e) {
    logger.error({ error: e, tenantId: authResult.auth.tenantId }, 'WebAuthn registration begin failed')
    return NextResponse.json(
      safeErrorResponse(e),
      { status: 500 },
    )
  }
}
