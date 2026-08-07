/**
 * POST /api/billing/nowpayments/webhook
 * NowPayments IPN (Instant Payment Notification) webhook handler.
 *
 * NowPayments sends HMAC-signed webhooks when crypto payments are:
 *   - waiting (created, awaiting payment)
 *   - confirming (payment received, awaiting confirmations)
 *   - confirmed (enough confirmations)
 *   - sending (payout to merchant in progress)
 *   - finished (payout complete — this is the "success" state)
 *   - failed / expired
 *
 * The webhook signature is verified using HMAC-SHA256 with the IPN secret.
 */

import { NextRequest, NextResponse } from 'next/server'
import { handleNowPaymentsWebhook } from '@/lib/billing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Read raw body as text for signature verification
  const rawBody = await req.text()
  const signature = req.headers.get('x-nowpayments-sig') ?? ''

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = await handleNowPaymentsWebhook(body, signature)

  if (!result.received) {
    return NextResponse.json(
      { error: result.error ?? 'Webhook rejected' },
      { status: 400 },
    )
  }

  return NextResponse.json({ received: true })
}
