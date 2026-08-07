/**
 * GET /api/saml/login?tenant=xxx&redirect=/admin
 * Initiates SAML SSO — redirects user to the IdP's SSO URL with a SAML AuthnRequest.
 *
 * After authentication, the IdP POSTs the SAML Response to /api/saml/acs.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createLoginRequest } from '@/lib/saml'
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

  logger.info({ tenantId }, 'SAML SSO redirect initiated')

  // Redirect to IdP
  return NextResponse.redirect(loginUrl)
}
