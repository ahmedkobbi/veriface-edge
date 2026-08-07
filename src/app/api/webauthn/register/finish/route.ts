/**
 * POST /api/webauthn/register/finish
 * Complete WebAuthn registration with full attestation verification.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { appendAudit } from '@/lib/audit'
import { finishWebAuthnRegistration } from '@/lib/webauthn'
import { validateInput, WebAuthnRegisterFinishSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { safeErrorResponse } from '@/lib/config'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  const body = await req.json()
  const validation = validateInput(WebAuthnRegisterFinishSchema, body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }
  const { sessionId, credentialId, publicKey, attestationObject, clientDataJSON, transports, aaguid, deviceType, backedUp } = validation.data

  try {
    const session = await db.session.findUnique({ where: { id: sessionId } })
    if (!session || session.tenantId !== authResult.auth.tenantId) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 })
    }
    if (session.flow !== 'webauthn_enroll') {
      return NextResponse.json({ success: false, error: 'Wrong session flow' }, { status: 400 })
    }
    if (session.expiresAt < new Date()) {
      return NextResponse.json({ success: false, error: 'Session expired' }, { status: 410 })
    }

    // Build the credential response for @simplewebauthn/server
    const credentialResponse = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        attestationObject,
        clientDataJSON,
        getPublicKey: () => publicKey,
      },
      transports: transports ?? [],
    }

    const result = await finishWebAuthnRegistration(
      session.tenantId,
      session.targetUserId!,
      session.challenge,
      credentialResponse,
    )

    if (!result.verified) {
      await db.session.update({
        where: { id: sessionId },
        data: { state: 'failed' },
      })
      return NextResponse.json(
        { success: false, error: 'Attestation verification failed' },
        { status: 400 },
      )
    }

    await db.session.update({
      where: { id: sessionId },
      data: { state: 'success', result: JSON.stringify({ credentialId: result.credentialId }) },
    })

    await appendAudit({
      tenantId: session.tenantId,
      eventType: 'webauthn.enrolled',
      payload: {
        credentialId: result.credentialId,
        userId: session.targetUserId,
        aaguid,
        deviceType,
        backedUp,
      },
      apiKeyId: authResult.auth.apiKeyId,
    })

    logger.info({ tenantId: session.tenantId, credentialId: result.credentialId }, 'WebAuthn credential registered')

    return NextResponse.json({
      success: true,
      credentialId: result.credentialId,
      message: 'WebAuthn credential registered. User can now authenticate with face + hardware authenticator.',
    })
  } catch (e) {
    logger.error({ error: e, sessionId }, 'WebAuthn registration finish failed')
    return NextResponse.json(
      safeErrorResponse(e),
      { status: 500 },
    )
  }
}
