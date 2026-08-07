/**
 * GET /api/billing/status
 * Returns the current billing status (subscription, invoices, payments).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { getBillingStatus, isStripeConfigured, isNowPaymentsConfigured, BILLING_PLANS } from '@/lib/billing'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const status = await getBillingStatus(session.tenantId)

  return NextResponse.json({
    success: true,
    billing: status,
    plans: BILLING_PLANS,
    stripeConfigured: isStripeConfigured(),
    nowpaymentsConfigured: isNowPaymentsConfigured(),
  })
}
