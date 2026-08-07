/**
 * POST /api/billing/portal
 * Create a Stripe Customer Portal session.
 *
 * Returns: { url } — redirect the user to this URL to manage billing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { createCustomerPortalSession, isStripeConfigured } from '@/lib/billing'

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Stripe is not configured' },
      { status: 503 },
    )
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  try {
    const result = await createCustomerPortalSession({
      tenantId: session.tenantId,
      returnUrl: `${baseUrl}/admin?tab=rate-limits`,
    })
    return NextResponse.json({ success: true, url: result.url })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
