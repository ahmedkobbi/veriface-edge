/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for plan upgrade.
 *
 * SECURITY:
 *   - Price is NEVER trusted from the client. The client sends only
 *     `planTier` + `interval`. The actual price is looked up from the
 *     server-side BILLING_PLANS constant and passed to Stripe as a
 *     `priceId` (Stripe Price object). The client cannot influence
 *     the amount charged.
 *   - The `success_url` is DISPLAY-ONLY. It does NOT activate the
 *     subscription. Subscription activation happens exclusively in the
 *     Stripe webhook handler (`handleCheckoutCompleted`) when the
 *     `checkout.session.completed` event is received.
 *   - Customer email is taken from the authenticated session, not the
 *     client request body.
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
  // NOTE: No `price` or `amount` field accepted from the client.
  // The price is determined server-side from BILLING_PLANS.
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

  // Server-side price lookup (client cannot influence this)
  const plan = BILLING_PLANS[planTier]
  if (!plan) {
    return NextResponse.json({ success: false, error: 'Invalid plan' }, { status: 400 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  try {
    const result = await createCheckoutSession({
      tenantId: session.tenantId,
      planTier,
      interval,
      // Email from authenticated session — NOT from the client request body
      customerEmail: session.user.email,
      // success_url is display-only — does NOT trigger business logic.
      // The subscription is activated via the Stripe webhook
      // (checkout.session.completed event), not via this redirect.
      successUrl: `${baseUrl}/admin?tab=rate-limits&checkout=success`,
      cancelUrl: `${baseUrl}/admin?tab=rate-limits&checkout=canceled`,
    })

    return NextResponse.json({ success: true, url: result.url, sessionId: result.sessionId })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
