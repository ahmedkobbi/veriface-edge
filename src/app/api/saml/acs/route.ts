/**
 * POST /api/saml/acs
 * Assertion Consumer Service — receives the SAML Response from the IdP.
 *
 * The IdP POSTs a form with `SAMLResponse` field (base64-encoded XML).
 * This endpoint:
 *   1. Verifies the SAML response signature
 *   2. Extracts user attributes (email, name)
 *   3. Provisions or links the user
 *   4. Issues a session cookie
 *   5. Redirects to the admin panel
 *
 * Also handles GET for redirect-based ACS (some IdPs use GET binding).
 *
 * SECURITY FIX (B-08): The RelayState is now a SIGNED token (HMAC-SHA256).
 * Previously, RelayState was trusted as the tenant ID without validation —
 * an attacker could substitute a different tenant ID, causing the SAML
 * response to be verified against a different tenant's IdP certificate.
 * Now: the signature is verified before extracting the tenantId.
 */

import { NextRequest, NextResponse } from 'next/server'
import { completeSamlLogin } from '@/lib/saml'
import { verifySignedRelayState } from '@/lib/saml-relay-state'
import { logger } from '@/lib/logger'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.SITE_URL ?? 'http://localhost:3000'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const samlResponse = formData.get('SAMLResponse') as string
    const relayState = formData.get('RelayState') as string | null

    if (!samlResponse) {
      return NextResponse.json({ error: 'Missing SAMLResponse' }, { status: 400 })
    }

    // SECURITY FIX (B-08): Verify the signed RelayState token.
    // The tenantId is extracted ONLY from the verified token — never from
    // the SAML response itself (which could be crafted by an attacker).
    if (!relayState) {
      logger.error('SAML ACS: no RelayState provided — rejecting (B-08 fix)')
      return NextResponse.redirect(`${APP_URL}/?saml_error=no_relay_state`)
    }

    const relayStatePayload = verifySignedRelayState(relayState)
    if (!relayStatePayload) {
      logger.error('SAML ACS: RelayState signature verification failed — possible tenant substitution attack')
      return NextResponse.redirect(`${APP_URL}/?saml_error=invalid_relay_state`)
    }

    const tenantId = relayStatePayload.tenantId

    const result = await completeSamlLogin(tenantId, samlResponse)
    if (!result) {
      return NextResponse.redirect(`${APP_URL}/?saml_error=auth_failed`)
    }

    const { cookieHeader, user, isNewUser } = result

    // Redirect to admin panel with success (use the redirect from RelayState if present)
    const redirectPath = relayStatePayload.redirect ?? (isNewUser ? '/?saml_welcome=true' : '/')
    const redirectUrl = `${APP_URL}${redirectPath}`
    const response = NextResponse.redirect(redirectUrl)
    response.headers.set('Set-Cookie', cookieHeader)
    return response
  } catch (e) {
    logger.error({ error: e }, 'SAML ACS error')
    return NextResponse.redirect(`${APP_URL}/?saml_error=server_error`)
  }
}

// GET fallback (some IdPs use GET binding — rare but supported)
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const samlResponse = url.searchParams.get('SAMLResponse')
  const relayState = url.searchParams.get('RelayState')

  if (!samlResponse) {
    return NextResponse.json({ error: 'Missing SAMLResponse' }, { status: 400 })
  }

  // SECURITY FIX (B-08): Verify signed RelayState for GET binding too
  if (!relayState) {
    logger.error('SAML ACS (GET): no RelayState provided — rejecting')
    return NextResponse.redirect(`${APP_URL}/?saml_error=no_relay_state`)
  }

  const relayStatePayload = verifySignedRelayState(relayState)
  if (!relayStatePayload) {
    logger.error('SAML ACS (GET): RelayState signature verification failed')
    return NextResponse.redirect(`${APP_URL}/?saml_error=invalid_relay_state`)
  }

  // Decode and process
  const decoded = Buffer.from(samlResponse, 'base64').toString('utf-8')

  const result = await completeSamlLogin(relayStatePayload.tenantId, decoded)
  if (!result) {
    return NextResponse.redirect(`${APP_URL}/?saml_error=auth_failed`)
  }

  const redirectPath = relayStatePayload.redirect ?? '/'
  const response = NextResponse.redirect(`${APP_URL}${redirectPath}`)
  response.headers.set('Set-Cookie', result.cookieHeader)
  return response
}
