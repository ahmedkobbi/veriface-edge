/**
 * POST /api/webauthn/auth/begin
 * Begin WebAuthn authentication (assertion flow).
 *
 * Body: { externalUserId: string }
 *
 * Returns: PublicKeyCredentialRequestOptions + sessionId.
 * The SDK must produce BOTH a face ZK proof AND a WebAuthn assertion
 * to complete step-up authentication.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { secureRandomHex } from '@/lib/crypto-server'

const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { externalUserId } = body
    if (!externalUserId) {
      return NextResponse.json({ success: false, error: 'externalUserId required' }, { status: 400 })
    }

    const tenantId = authResult.auth.tenantId!

    const user = await db.user.findFirst({ where: { tenantId, externalUserId } })
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    const credentials = await db.webAuthnCredential.findMany({
      where: { tenantId, userId: user.id },
    })
    if (credentials.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No WebAuthn credentials registered for this user' },
        { status: 404 },
      )
    }

    const challenge = secureRandomHex(32)
    const session = await db.session.create({
      data: {
        tenantId,
        challenge,
        backendPubKey: 'webauthn-auth',
        flow: 'webauthn_verify',
        targetUserId: user.id,
        clientIp: authResult.ip,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    })

    const requestOptions = {
      challenge: Uint8Array.from(
        (await import('@/lib/crypto-server')).hex.decode(challenge),
      ),
      rpId: RP_ID,
      timeout: 60_000,
      userVerification: 'required' as const,
      allowCredentials: credentials.map((c) => ({
        type: 'public-key' as const,
        id: Uint8Array.from(
          (await import('@/lib/crypto-server')).hex.decode(c.credentialId.replace(/-/g, '+').replace(/_/g, '/')),
        ),
        transports: JSON.parse(c.transports) ?? [],
      })),
    }

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      challenge,
      options: requestOptions,
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
