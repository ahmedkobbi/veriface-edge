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
 */

import { NextRequest, NextResponse } from 'next/server'
import { completeSamlLogin } from '@/lib/saml'
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

    // Decode base64 SAML response to extract tenant (from entityID or RelayState)
    // RelayState should contain the tenant ID (set during login redirect)
    const tenantId = relayState ?? extractTenantFromResponse(samlResponse)

    if (!tenantId) {
      logger.error('SAML ACS: no tenant ID in RelayState or response')
      return NextResponse.redirect(`${APP_URL}/?saml_error=no_tenant`)
    }

    const result = await completeSamlLogin(tenantId, samlResponse)
    if (!result) {
      return NextResponse.redirect(`${APP_URL}/?saml_error=auth_failed`)
    }

    const { cookieHeader, user, isNewUser } = result

    // Redirect to admin panel with success
    const redirectUrl = isNewUser ? `${APP_URL}/?saml_welcome=true` : `${APP_URL}/`
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

  // Decode and process
  const decoded = Buffer.from(samlResponse, 'base64').toString('utf-8')
  const tenantId = relayState ?? extractTenantFromResponse(samlResponse)

  if (!tenantId) {
    return NextResponse.redirect(`${APP_URL}/?saml_error=no_tenant`)
  }

  const result = await completeSamlLogin(tenantId, decoded)
  if (!result) {
    return NextResponse.redirect(`${APP_URL}/?saml_error=auth_failed`)
  }

  const response = NextResponse.redirect(`${APP_URL}/`)
  response.headers.set('Set-Cookie', result.cookieHeader)
  return response
}

/**
 * Try to extract tenant ID from SAML response destination/audience.
 * Falls back to null — tenant must be in RelayState.
 */
function extractTenantFromResponse(samlResponse: string): string | null {
  try {
    const decoded = Buffer.from(samlResponse, 'base64').toString('utf-8')
    // Look for the ACS URL which contains the tenant
    const acsMatch = decoded.match(/Destination="([^"]*\/api\/saml\/acs[^"]*)"/)
    if (acsMatch) {
      // ACS URL doesn't contain tenant — we need RelayState
      return null
    }
    return null
  } catch {
    return null
  }
}
