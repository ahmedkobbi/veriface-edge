/**
 * POST /api/webauthn/register/begin
 * Begin FIDO2/WebAuthn credential registration for a user.
 *
 * Hybrid flow: pairs a facial template with a hardware authenticator
 * (YubiKey, Touch ID, Windows Hello) for step-up authentication.
 *
 * Body: { externalUserId: string, deviceType?: 'roaming'|'platform' }
 *
 * Returns: PublicKeyCredentialCreationOptions (WebAuthn spec)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { secureRandomHex, hex } from '@/lib/crypto-server'

const RP_NAME = 'VeriFace Edge'
// In production: this would be the enterprise client's domain.
const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost'
const RP_ORIGIN = process.env.WEBAUTHN_RP_ORIGIN ?? 'http://localhost:3000'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { externalUserId, deviceType } = body
    if (!externalUserId) {
      return NextResponse.json({ success: false, error: 'externalUserId required' }, { status: 400 })
    }

    const tenantId = authResult.auth.tenantId!

    // Find or create user
    let user = await db.user.findFirst({
      where: { tenantId, externalUserId },
    })
    if (!user) {
      user = await db.user.create({
        data: {
          tenantId,
          externalUserId,
          revocationToken: secureRandomHex(32),
        },
      })
    }

    // Generate challenge
    const challenge = secureRandomHex(32)
    const userId = secureRandomHex(32)

    // Store challenge in a pending session for the finish step
    const session = await db.session.create({
      data: {
        tenantId,
        challenge,
        backendPubKey: 'webauthn-register',
        flow: 'webauthn_enroll',
        targetUserId: user.id,
        clientIp: authResult.ip,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),  // 5 min for WebAuthn
      },
    })

    const creationOptions = {
      challenge: Uint8Array.from(hex.decode(challenge)),
      rp: {
        name: RP_NAME,
        id: RP_ID,
      },
      user: {
        id: Uint8Array.from(hex.decode(userId)),
        name: externalUserId,
        displayName: externalUserId,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },    // ES256
        { type: 'public-key', alg: -257 },  // RS256
        { type: 'public-key', alg: -8 },    // EdDSA
      ],
      timeout: 60_000,
      attestation: 'direct',
      authenticatorSelection: {
        authenticatorAttachment: deviceType === 'platform' ? 'platform' : 'cross-platform',
        userVerification: 'required',
        requireResidentKey: false,
      },
      excludeCredentials: [],
      extensions: {
        credProps: true,
      },
    }

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      options: creationOptions,
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
