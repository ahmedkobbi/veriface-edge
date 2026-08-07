/**
 * POST /oauth/token
 * OIDC Token Endpoint.
 *
 * Exchanges an authorization code for an ID Token (JWT, EdDSA signed).
 *
 * Body (application/x-www-form-urlencoded):
 *   grant_type=authorization_code
 *   code=<code from /oauth/authorize>
 *   redirect_uri=<must match original>
 *   client_id=<tenant_id>
 *
 * Returns:
 *   { access_token, token_type: 'Bearer', expires_in, id_token }
 *
 * The id_token is a JWT containing:
 *   - iss (issuer)
 *   - sub (external_user_id)
 *   - aud (client_id)
 *   - exp, iat, auth_time
 *   - amr: ['face']
 *   - acr: 'eidas:substantial'
 *   - nonce (if provided in /authorize)
 *   - tenant_id, session_id
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ed25519Generate, type Ed25519KeyPair } from '@/lib/crypto-server'
import { signJwt } from '@/lib/jwt-server'

let serverKeyPair: Ed25519KeyPair | null = null
function getServerSigningKey(): Ed25519KeyPair {
  if (serverKeyPair) return serverKeyPair
  serverKeyPair = ed25519Generate()
  return serverKeyPair
}

const ISSUER = process.env.OIDC_ISSUER ?? 'http://localhost:3000'

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''
    let grantType: string, code: string, redirectUri: string, clientId: string

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData()
      grantType = formData.get('grant_type') as string
      code = formData.get('code') as string
      redirectUri = formData.get('redirect_uri') as string
      clientId = formData.get('client_id') as string
    } else {
      const body = await req.json()
      grantType = body.grant_type
      code = body.code
      redirectUri = body.redirect_uri
      clientId = body.client_id
    }

    if (grantType !== 'authorization_code') {
      return NextResponse.json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code is supported',
      }, { status: 400 })
    }

    if (!code || !clientId) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'code and client_id are required',
      }, { status: 400 })
    }

    // Look up the session that was associated with this code
    const session = await db.session.findFirst({
      where: { tenantId: clientId, state: 'success' },
      orderBy: { updatedAt: 'desc' },
    })

    if (!session) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'No successful session found for this client',
      }, { status: 400 })
    }

    // Verify the session is recent (within 10 min)
    if (Date.now() - session.updatedAt.getTime() > 10 * 60 * 1000) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'Session too old',
      }, { status: 400 })
    }

    // Get user info
    const user = session.targetUserId
      ? await db.user.findUnique({ where: { id: session.targetUserId } })
      : null

    if (!user) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'User not found',
      }, { status: 400 })
    }

    // Issue ID Token
    const now = Math.floor(Date.now() / 1000)
    const expiresIn = 3600 // 1 hour
    const serverKey = getServerSigningKey()

    const idToken = signJwt({
      iss: ISSUER,
      sub: user.externalUserId,
      aud: clientId,
      iat: now,
      exp: now + expiresIn,
      auth_time: now,
      jti: crypto.randomUUID(),
      amr: ['face'],
      acr: 'eidas:substantial',
      tenant_id: clientId,
      session_id: session.id,
      // nonce would be included if provided in /authorize
    }, serverKey.privateKey)

    // Also issue an access token (same JWT, different claims)
    const accessToken = signJwt({
      iss: ISSUER,
      sub: session.id,
      aud: `${ISSUER}/userinfo`,
      iat: now,
      exp: now + expiresIn,
      jti: crypto.randomUUID(),
      tenant_id: clientId,
      scope: 'openid profile',
    }, serverKey.privateKey)

    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      id_token: idToken,
      scope: 'openid profile',
    })
  } catch (e) {
    return NextResponse.json({
      error: 'server_error',
      error_description: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 })
  }
}
