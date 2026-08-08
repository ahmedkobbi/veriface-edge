/**
 * GET /api/saml/login?tenant=xxx&redirect=/admin
 * Initiates SAML SSO — redirects user to the IdP's SSO URL with a SAML AuthnRequest.
 *
 * After authentication, the IdP POSTs the SAML Response to /api/saml/acs.
 *
 * SECURITY FIX (B-08): The RelayState is now a SIGNED token (HMAC-SHA256
 * with the server signing key) containing the tenantId + redirect + nonce +
 * expiry. This prevents an attacker from substituting a different tenant ID
 * in the RelayState when the IdP posts back to the ACS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createLoginRequest } from '@/lib/saml'
import { createSignedRelayState } from '@/lib/saml-relay-state'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant')
  const redirect = url.searchParams.get('redirect') ?? '/admin'

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant parameter required' }, { status: 400 })
  }

  const loginUrl = await createLoginRequest(tenantId)
  if (!loginUrl) {
    return NextResponse.json({ error: 'SAML not configured or disabled for this tenant' }, { status: 404 })
  }

  // SECURITY FIX (B-08): Create a signed RelayState token.
  // The IdP will return this verbatim in the ACS POST. The ACS endpoint
  // verifies the signature before extracting the tenantId — preventing
  // tenant substitution attacks.
  const relayState = createSignedRelayState(tenantId, redirect)

  // Append RelayState to the IdP login URL
  const loginUrlObj = new URL(loginUrl)
  loginUrlObj.searchParams.set('RelayState', relayState)

  logger.info({ tenantId }, 'SAML SSO redirect initiated (signed RelayState)')

  // Redirect to IdP
  return NextResponse.redirect(loginUrlObj.toString())
}
