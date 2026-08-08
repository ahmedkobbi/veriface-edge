/**
 * POST /api/billing/nowpayments/webhook
 * NowPayments IPN (Instant Payment Notification) webhook handler.
 *
 * SECURITY: Uses raw request body for HMAC signature verification (C-10 fix).
 */

import { NextRequest, NextResponse } from 'next/server'
import { handleNowPaymentsWebhook } from '@/lib/billing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Read raw body as text for signature verification (C-10 fix)
  const rawBody = await req.text()
  const signature = req.headers.get('x-nowpayments-sig') ?? ''

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Pass both raw body (for HMAC) and parsed body (for processing)
  const result = await handleNowPaymentsWebhook(rawBody, body, signature)

  if (!result.received) {
    return NextResponse.json(
      { error: result.error ?? 'Webhook rejected' },
      { status: 400 },
    )
  }

  return NextResponse.json({ received: true })
}
