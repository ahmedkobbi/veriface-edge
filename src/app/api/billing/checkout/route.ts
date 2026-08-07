/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for plan upgrade.
 *
 * Body: { planTier: 'growth'|'enterprise', interval: 'month'|'year' }
 * Returns: { url, sessionId }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { createCheckoutSession, isStripeConfigured, BILLING_PLANS } from '@/lib/billing'
import { z } from 'zod'

const CheckoutSchema = z.object({
  planTier: z.enum(['growth', 'enterprise']),
  interval: z.enum(['month', 'year']).default('month'),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Stripe is not configured. Set STRIPE_SECRET_KEY env var.' },
      { status: 503 },
    )
  }

  const body = await req.json()
  const validation = CheckoutSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { planTier, interval } = validation.data
  const plan = BILLING_PLANS[planTier]

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  try {
    const result = await createCheckoutSession({
      tenantId: session.tenantId,
      planTier,
      interval,
      customerEmail: session.user.email,
      successUrl: `${baseUrl}/admin?tab=rate-limits&checkout=success`,
      cancelUrl: `${baseUrl}/admin?tab=rate-limits&checkout=canceled`,
    })

    return NextResponse.json({ success: true, url: result.url, sessionId: result.sessionId })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
