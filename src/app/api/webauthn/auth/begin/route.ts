/**
 * POST /api/webauthn/auth/begin
 * Begin WebAuthn authentication (assertion flow).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { secureRandomHex } from '@/lib/crypto-server'
import { beginWebAuthnAuthentication } from '@/lib/webauthn'
import { validateInput, WebAuthnAuthBeginSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  const body = await req.json()
  const validation = validateInput(WebAuthnAuthBeginSchema, body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }
  const { externalUserId } = validation.data

  try {
    const result = await beginWebAuthnAuthentication(
      authResult.auth.tenantId!,
      externalUserId,
    )

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: 404 })
    }

    const session = await db.session.create({
      data: {
        tenantId: authResult.auth.tenantId!,
        challenge: result.options.challenge,
        backendPubKey: 'webauthn-auth',
        flow: 'webauthn_verify',
        targetUserId: result.userId,
        clientIp: authResult.ip,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    })

    logger.info({ tenantId: authResult.auth.tenantId, sessionId: session.id }, 'WebAuthn auth started')

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      options: result.options,
    })
  } catch (e) {
    logger.error({ error: e }, 'WebAuthn auth begin failed')
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
