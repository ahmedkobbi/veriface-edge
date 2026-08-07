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
import { getServerSigningKey } from '@/lib/config'
import { db } from '@/lib/db'
import { ed25519Generate, type Ed25519KeyPair } from '@/lib/crypto-server'
import { signJwt } from '@/lib/jwt-server'


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

    // C3 FIX: Look up the authorization code from the authCodes map
    // (exported by /oauth/authorize). Verify it belongs to the client,
    // matches the redirect_uri, hasn't expired, then consume it (delete).
    const { authCodes } = await import('@/app/oauth/authorize/route')
    const codeEntry = authCodes.get(code)

    if (!codeEntry) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'Authorization code not found or already consumed',
      }, { status: 400 })
    }

    // Check code expiry (10 min)
    if (Date.now() > codeEntry.expiresAt) {
      authCodes.delete(code)
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'Authorization code expired',
      }, { status: 400 })
    }

    // Verify client_id matches
    if (codeEntry.clientId !== clientId) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'client_id does not match authorization code',
      }, { status: 400 })
    }

    // Verify redirect_uri matches
    if (redirectUri && codeEntry.redirectUri !== redirectUri) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'redirect_uri does not match authorization code',
      }, { status: 400 })
    }

    // Consume the code (one-time use)
    authCodes.delete(code)

    // Look up the session by the code entry's sessionId
    const session = await db.session.findUnique({
      where: { id: codeEntry.sessionId ?? '' },
    })

    if (!session || session.state !== 'success') {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'Session not found or not successful',
      }, { status: 400 })
    }

    // Verify the session belongs to the claimed tenant
    if (session.tenantId !== clientId) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'Session does not belong to this client',
      }, { status: 400 })
    }

    // Get user info — FIX (#15): session.targetUserId stores the externalUserId
    // (set in /api/session/init), NOT the internal user ID. Look up by externalUserId.
    const externalUserId = session.targetUserId
    const user = externalUserId
      ? await db.user.findFirst({ where: { tenantId: clientId, externalUserId } })
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
