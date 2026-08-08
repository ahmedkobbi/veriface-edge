/**
 * GET /oauth/authorize
 * OIDC Authorization Endpoint.
 *
 * Flow:
 *   1. Enterprise client redirects user to this URL with client_id + redirect_uri
 *   2. VeriFace renders the face auth page
 *   3. On successful face auth, user is redirected back to redirect_uri
 *      with an authorization code
 *   4. Client exchanges code for ID Token at /oauth/token
 *
 * This implementation handles the redirect + code issuance. The actual
 * face auth happens via the SDK on the rendered page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { secureRandomHex, sha256Hex } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

interface AuthorizeParams {
  client_id: string
  redirect_uri: string
  response_type: string
  scope: string
  state?: string
  nonce?: string
  external_user_id?: string
}

// In-memory authorization code store (production: Redis)
// SECURITY FIX (B-02): Separated into two stages:
//   1. "pending" entries (renderToken) — created by GET, NO auth code yet
//   2. "completed" entries (authCode) — created by POST after face auth succeeds
// Previously, the GET handler generated the auth code immediately, allowing
// an attacker to obtain a valid code without completing face auth.
interface PendingAuthRequest {
  tenantId: string
  clientId: string
  redirectUri: string
  externalUserId: string
  nonce?: string
  state?: string
  expiresAt: number
  // Set by POST after face auth succeeds
  authCode?: string
  sessionId?: string
  codeIssued: boolean
}
const authCodes = new Map<string, PendingAuthRequest>()

// Cleanup expired codes every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of authCodes) {
    if (entry.expiresAt < now) authCodes.delete(key)
  }
}, 5 * 60 * 1000).unref?.()

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const params: AuthorizeParams = {
    client_id: url.searchParams.get('client_id') ?? '',
    redirect_uri: url.searchParams.get('redirect_uri') ?? '',
    response_type: url.searchParams.get('response_type') ?? 'code',
    scope: url.searchParams.get('scope') ?? 'openid',
    state: url.searchParams.get('state') ?? undefined,
    nonce: url.searchParams.get('nonce') ?? undefined,
    external_user_id: url.searchParams.get('external_user_id') ?? undefined,
  }

  // Validate required params
  if (!params.client_id || !params.redirect_uri) {
    return NextResponse.json({
      error: 'invalid_request',
      error_description: 'client_id and redirect_uri are required',
    }, { status: 400 })
  }

  if (params.response_type !== 'code') {
    return NextResponse.json({
      error: 'unsupported_response_type',
      error_description: 'Only "code" response_type is supported',
    }, { status: 400 })
  }

  // Look up tenant by client_id (we use tenantId as the OIDC client_id)
  const tenant = await db.tenant.findUnique({ where: { id: params.client_id } })
  if (!tenant || !tenant.active) {
    return NextResponse.json({
      error: 'invalid_client',
      error_description: 'Unknown or inactive client_id',
    }, { status: 401 })
  }

  // Validate redirect_uri (in production: maintain allowlist per tenant)
  if (!params.redirect_uri.startsWith('https://') && process.env.NODE_ENV === 'production') {
    return NextResponse.json({
      error: 'invalid_request',
      error_description: 'redirect_uri must be HTTPS in production',
    }, { status: 400 })
  }

  // SECURITY FIX (B-02): Do NOT generate the auth code here.
  // Previously, the code was generated and returned in this GET response,
  // allowing an attacker to obtain a valid code without completing face auth.
  // Now: we issue a "render token" that the client must POST back with a
  // valid session_id AFTER face auth succeeds. Only then is the auth code
  // generated.
  const renderToken = secureRandomHex(16)
  authCodes.set(renderToken, {
    tenantId: tenant.id,
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    externalUserId: params.external_user_id ?? '',
    nonce: params.nonce,
    state: params.state,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
    codeIssued: false,
  })

  return NextResponse.json({
    success: true,
    renderToken,
    expires_in: 600,
    message: 'Complete face authentication, then POST renderToken + session_id to obtain an authorization code.',
  })
}

/**
 * POST /oauth/authorize
 * Complete the authorization after face auth succeeds.
 *
 * Body: { renderToken: string, session_id: string }
 *
 * SECURITY FIX (B-02): The auth code is generated HERE, only after verifying
 * the face auth session was successful. The renderToken from GET is used to
 * look up the pending request — it is NOT the auth code.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { renderToken, session_id } = body

    if (!renderToken || !session_id) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'renderToken and session_id required',
      }, { status: 400 })
    }

    const entry = authCodes.get(renderToken)
    if (!entry || entry.expiresAt < Date.now()) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'Authorization request expired or invalid',
      }, { status: 400 })
    }

    // SECURITY FIX (B-02): Prevent code re-issuance
    if (entry.codeIssued) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'Authorization code already issued for this request',
      }, { status: 400 })
    }

    // Verify the session completed successfully
    const session = await db.session.findUnique({ where: { id: session_id } })
    if (!session || session.state !== 'success' || session.tenantId !== entry.tenantId) {
      return NextResponse.json({
        error: 'access_denied',
        error_description: 'Face authentication not completed',
      }, { status: 403 })
    }

    // SECURITY FIX (B-02): Verify the session's targetUserId matches the
    // externalUserId from the authorize request. This prevents an attacker
    // from using a different user's session to complete the authorization.
    if (entry.externalUserId && session.targetUserId !== entry.externalUserId) {
      logger.warn(
        { expectedUser: entry.externalUserId, sessionUser: session.targetUserId },
        'OIDC: session user does not match authorize request user — rejecting',
      )
      return NextResponse.json({
        error: 'access_denied',
        error_description: 'Session user does not match authorization request',
      }, { status: 403 })
    }

    // NOW generate the auth code (after face auth is verified)
    const authCode = secureRandomHex(32) // 64 hex chars — 256 bits of entropy
    entry.authCode = authCode
    entry.sessionId = session_id
    entry.codeIssued = true

    // Migrate the entry to the authCode key (so /oauth/token can look it up by code)
    authCodes.set(authCode, entry)
    // Keep the renderToken entry too (marked as issued) so it can't be reused

    // Build redirect URL
    const redirectUrl = new URL(entry.redirectUri)
    redirectUrl.searchParams.set('code', authCode)
    if (entry.state) redirectUrl.searchParams.set('state', entry.state)

    return NextResponse.json({
      success: true,
      code: authCode,
      redirect_uri: redirectUrl.toString(),
    })
  } catch (e) {
    return NextResponse.json({
      error: 'server_error',
      error_description: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 })
  }
}

// Export auth code store for /oauth/token to consume
export { authCodes }
