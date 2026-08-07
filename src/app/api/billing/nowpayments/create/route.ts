/**
 * POST /api/billing/nowpayments/create
 * Create a NowPayments crypto invoice for plan upgrade.
 *
 * Body: { planTier: 'growth'|'enterprise', interval: 'month'|'year' }
 * Returns: { invoiceUrl, invoiceId, payAddress, payAmount, payCurrency }
 *
 * Supports USDC, BTC, ETH, and 50+ other cryptocurrencies.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { createNowPaymentsInvoice, isNowPaymentsConfigured } from '@/lib/billing'
import { z } from 'zod'

const CryptoCheckoutSchema = z.object({
  planTier: z.enum(['growth', 'enterprise']),
  interval: z.enum(['month', 'year']).default('month'),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (!isNowPaymentsConfigured()) {
    return NextResponse.json(
      { success: false, error: 'NowPayments is not configured. Set NOWPAYMENTS_API_KEY + NOWPAYMENTS_IPN_SECRET env vars.' },
      { status: 503 },
    )
  }

  const body = await req.json()
  const validation = CryptoCheckoutSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  try {
    const result = await createNowPaymentsInvoice({
      tenantId: session.tenantId,
      planTier: validation.data.planTier,
      interval: validation.data.interval,
      customerEmail: session.user.email,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
