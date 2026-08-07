/**
 * POST /api/billing/report-usage
 * Cron endpoint — reports monthly API usage to Stripe (metered billing).
 *
 * Auth: Requires CRON_SECRET header (fail-closed in production).
 * Called at the end of each billing period.
 */

import { NextRequest, NextResponse } from 'next/server'
import { reportUsageToStripe } from '@/lib/billing'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
    }
  } else if (cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  // Find all tenants with active subscriptions
  const subscriptions = await db.subscription.findMany({
    where: { status: 'active', stripeSubscriptionId: { not: null } },
    select: { tenantId: true },
  })

  let reported = 0
  for (const sub of subscriptions) {
    try {
      await reportUsageToStripe(sub.tenantId)
      reported++
    } catch (e) {
      logger.warn({ error: e, tenantId: sub.tenantId }, 'Usage reporting failed')
    }
  }

  logger.info({ monthKey, reported, total: subscriptions.length }, 'Usage reported to Stripe')

  return NextResponse.json({
    success: true,
    monthKey,
    tenantsReported: reported,
    totalTenants: subscriptions.length,
  })
}
