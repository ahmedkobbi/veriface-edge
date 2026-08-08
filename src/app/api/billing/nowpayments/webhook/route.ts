/**
 * POST /api/billing/nowpayments/webhook
 * NowPayments IPN (Instant Payment Notification) webhook handler.
 *
 * SECURITY:
 *   - C-10: Uses raw request body for HMAC signature verification
 *   - L-12: Verifies the signature BEFORE parsing the JSON body.
 *     Previously, `JSON.parse(rawBody)` ran before signature verification.
 *     A malicious payload could trigger parser vulnerabilities or consume
 *     excessive CPU (large/deeply-nested JSON) before being rejected.
 *     Now: the signature is checked first; only if valid do we parse.
 */

import { NextRequest, NextResponse } from 'next/server'
import { handleNowPaymentsWebhook } from '@/lib/billing'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Read raw body as text for signature verification (C-10 fix)
  const rawBody = await req.text()
  const signature = req.headers.get('x-nowpayments-sig') ?? ''

  // SECURITY FIX (L-12): Verify the signature BEFORE parsing the body.
  // This prevents a malicious payload from triggering JSON.parse on
  // untrusted input — which could cause CPU exhaustion or exploit
  // parser-specific vulnerabilities.
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET
  if (!ipnSecret) {
    return NextResponse.json(
      { error: 'IPN secret not configured' },
      { status: 503 },
    )
  }

  // If no signature is present, reject immediately (no parse)
  if (!signature) {
    return NextResponse.json(
      { error: 'Missing signature' },
      { status: 401 },
    )
  }

  // Compute the expected signature over the RAW body
  const expectedSig = createHmac('sha256', ipnSecret).update(rawBody).digest('hex')

  // Timing-safe comparison
  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSig)
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 },
    )
  }

  // Signature is valid — NOW it's safe to parse the body
  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Pass both raw body (for HMAC) and parsed body (for processing)
  // Note: handleNowPaymentsWebhook re-verifies the signature (defense in depth),
  // but we've already verified it here — the redundant check is harmless.
  const result = await handleNowPaymentsWebhook(rawBody, body, signature)

  if (!result.received) {
    return NextResponse.json(
      { error: result.error ?? 'Webhook rejected' },
      { status: 400 },
    )
  }

  return NextResponse.json({ received: true })
}
