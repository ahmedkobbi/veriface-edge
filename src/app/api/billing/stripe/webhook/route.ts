/**
 * POST /api/billing/stripe/webhook
 * Stripe webhook handler.
 *
 * CRITICAL: This route must read the RAW request body (not parsed JSON)
 * for signature verification to work. Next.js App Router requires
 * exporting `runtime = 'nodejs'` and reading the body as text.
 *
 * Stripe sends webhooks for:
 *   - checkout.session.completed
 *   - customer.subscription.created/updated/deleted
 *   - invoice.paid / invoice.payment_failed
 *   - payment_intent.succeeded
 */

import { NextRequest, NextResponse } from 'next/server'
import { handleStripeWebhook } from '@/lib/billing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Read raw body as text (required for signature verification)
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  const result = await handleStripeWebhook(rawBody, signature)

  if (!result.received) {
    return NextResponse.json(
      { error: result.error ?? 'Webhook rejected' },
      { status: 400 },
    )
  }

  return NextResponse.json({ received: true, event: result.event })
}
