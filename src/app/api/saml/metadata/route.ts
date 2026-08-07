/**
 * GET /api/saml/metadata?tenant=xxx
 * Returns the Service Provider metadata XML.
 * IdP admins import this URL into their IdP (Okta, Azure AD, etc.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSPMetadata } from '@/lib/saml'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenant')

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant parameter required' }, { status: 400 })
  }

  const metadata = await getSPMetadata(tenantId)
  if (!metadata) {
    return NextResponse.json({ error: 'SAML not configured for this tenant' }, { status: 404 })
  }

  return new NextResponse(metadata, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
