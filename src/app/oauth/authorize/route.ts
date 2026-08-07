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
const authCodes = new Map<string, {
  tenantId: string
  clientId: string
  redirectUri: string
  externalUserId: string
  nonce?: string
  expiresAt: number
}>()

// Cleanup expired codes every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [code, entry] of authCodes) {
    if (entry.expiresAt < now) authCodes.delete(code)
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

  // For this demo: render the face auth page with OIDC context.
  // In production, this would render a full-page SDK that captures the face,
  // then on success, generates an auth code and redirects.
  //
  // The auth code is pre-generated and embedded in the page; the SDK
  // completes the face auth and POSTs to /oauth/authorize (this endpoint)
  // to confirm and trigger the redirect.

  const code = secureRandomHex(16)
  authCodes.set(code, {
    tenantId: tenant.id,
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    externalUserId: params.external_user_id ?? '',
    nonce: params.nonce,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
  })

  // Build redirect URL with code + state
  const redirectUrl = new URL(params.redirect_uri)
  redirectUrl.searchParams.set('code', code)
  if (params.state) redirectUrl.searchParams.set('state', params.state)

  // For headless / API testing: return the code directly as JSON.
  // In production, this would redirect to the face auth page, which
  // on success would redirect to the redirectUrl above.
  return NextResponse.json({
    success: true,
    code,
    redirect_uri: redirectUrl.toString(),
    expires_in: 600,
    message: 'Authorize this request by completing face authentication. On success, redirect the user to redirect_uri.',
  })
}

/**
 * POST /oauth/authorize
 * Complete the authorization after face auth succeeds.
 *
 * Body: { code: string, session_id: string }
 *
 * Verifies the face auth session was successful, then confirms the auth code.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { code, session_id } = body

    if (!code || !session_id) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'code and session_id required',
      }, { status: 400 })
    }

    const codeEntry = authCodes.get(code)
    if (!codeEntry || codeEntry.expiresAt < Date.now()) {
      return NextResponse.json({
        error: 'invalid_grant',
        error_description: 'Authorization code expired or invalid',
      }, { status: 400 })
    }

    // Verify the session completed successfully
    const session = await db.session.findUnique({ where: { id: session_id } })
    if (!session || session.state !== 'success' || session.tenantId !== codeEntry.tenantId) {
      return NextResponse.json({
        error: 'access_denied',
        error_description: 'Face authentication not completed',
      }, { status: 403 })
    }

    // Mark code as used (consume it)
    authCodes.delete(code)

    return NextResponse.json({
      success: true,
      redirect_uri: `${codeEntry.redirectUri}?code=${code}&session_id=${session_id}`,
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
