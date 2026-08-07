/**
 * POST /api/webauthn/auth/finish
 * Complete WebAuthn authentication with full signature verification.
 * Uses @simplewebauthn/server for cryptographic assertion verification.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { appendAudit } from '@/lib/audit'
import { finishWebAuthnAuthentication } from '@/lib/webauthn'
import { validateInput, WebAuthnAuthFinishSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  const body = await req.json()
  const validation = validateInput(WebAuthnAuthFinishSchema, body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }
  const { sessionId, credentialId, authenticatorData, clientDataJSON, signature } = validation.data

  try {
    const session = await db.session.findUnique({ where: { id: sessionId } })
    if (!session || session.tenantId !== authResult.auth.tenantId) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 })
    }
    if (session.flow !== 'webauthn_verify') {
      return NextResponse.json({ success: false, error: 'Wrong session flow' }, { status: 400 })
    }
    if (session.expiresAt < new Date()) {
      return NextResponse.json({ success: false, error: 'Session expired' }, { status: 410 })
    }

    // Build the assertion response for @simplewebauthn/server
    const assertionResponse = {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        authenticatorData,
        clientDataJSON,
        signature,
      },
    }

    const result = await finishWebAuthnAuthentication(
      session.tenantId,
      session.challenge,
      assertionResponse,
    )

    if (!result.verified) {
      await db.session.update({
        where: { id: sessionId },
        data: { state: 'failed', result: JSON.stringify({ error: result.error }) },
      })
      await appendAudit({
        tenantId: session.tenantId,
        eventType: 'auth.failure',
        payload: { reason: 'WEBAUTHN_ASSERTION_FAILED', error: result.error },
        apiKeyId: authResult.auth.apiKeyId,
      })
      return NextResponse.json(
        { success: false, error: result.error ?? 'Assertion verification failed' },
        { status: 401 },
      )
    }

    await db.session.update({
      where: { id: sessionId },
      data: { state: 'success', result: JSON.stringify({ credentialId: result.credentialId }) },
    })

    await appendAudit({
      tenantId: session.tenantId,
      eventType: 'webauthn.verified',
      payload: {
        credentialId: result.credentialId,
        userId: result.userId,
      },
      apiKeyId: authResult.auth.apiKeyId,
    })

    logger.info({ tenantId: session.tenantId, credentialId: result.credentialId }, 'WebAuthn assertion verified')

    return NextResponse.json({
      success: true,
      verified: true,
      userId: result.userId,
      message: 'WebAuthn assertion accepted. Pair with face ZK proof for step-up authentication.',
      sessionId,
    })
  } catch (e) {
    logger.error({ error: e, sessionId }, 'WebAuthn auth finish failed')
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
