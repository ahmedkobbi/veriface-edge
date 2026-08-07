/**
 * GET /api/admin/notifications/stats
 * Returns deliverability stats for the email system:
 *   - Sent/failed/pending counts (24h, 7d, 30d)
 *   - Top templates by volume
 *   - Average attempts before success
 *   - Failure reasons (top 5 errors)
 *
 * Used by the admin Notifications dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const now = Date.now()
  const ranges = {
    '24h': new Date(now - 24 * 60 * 60 * 1000),
    '7d': new Date(now - 7 * 24 * 60 * 60 * 1000),
    '30d': new Date(now - 30 * 24 * 60 * 60 * 1000),
  }

  // Counts by state for each range
  const counts: Record<string, Record<string, number>> = {}
  for (const [range, since] of Object.entries(ranges)) {
    const rows = await db.emailLog.groupBy({
      by: ['state'],
      where: { tenantId: session.tenantId, createdAt: { gte: since } },
      _count: { state: true },
    })
    counts[range] = {}
    for (const r of rows) counts[range][r.state] = r._count.state
  }

  // Top templates by volume (last 30d)
  const topTemplates = await db.emailLog.groupBy({
    by: ['template'],
    where: { tenantId: session.tenantId, createdAt: { gte: ranges['30d'] } },
    _count: { template: true },
    orderBy: { _count: { template: 'desc' } },
    take: 10,
  })

  // Top failure errors (last 30d, failed state only)
  const topErrors = await db.emailLog.groupBy({
    by: ['lastError'],
    where: {
      tenantId: session.tenantId,
      state: 'failed',
      createdAt: { gte: ranges['30d'] },
      lastError: { not: null },
    },
    _count: { lastError: true },
    orderBy: { _count: { lastError: 'desc' } },
    take: 5,
  })

  // Average attempts (for sent emails)
  const sentAgg = await db.emailLog.aggregate({
    where: { tenantId: session.tenantId, state: 'sent', createdAt: { gte: ranges['30d'] } },
    _avg: { attempts: true },
    _count: { attempts: true },
  })

  // Deliverability rate (sent / (sent + failed)) for 30d
  const sent30 = counts['30d'].sent ?? 0
  const failed30 = counts['30d'].failed ?? 0
  const suppressed30 = counts['30d'].suppressed ?? 0
  const deliverabilityRate = sent30 + failed30 > 0 ? (sent30 / (sent30 + failed30)) * 100 : 100

  return NextResponse.json({
    success: true,
    counts: {
      '24h': { sent: counts['24h'].sent ?? 0, failed: counts['24h'].failed ?? 0, pending: counts['24h'].pending ?? 0, suppressed: counts['24h'].suppressed ?? 0 },
      '7d': { sent: counts['7d'].sent ?? 0, failed: counts['7d'].failed ?? 0, pending: counts['7d'].pending ?? 0, suppressed: counts['7d'].suppressed ?? 0 },
      '30d': { sent: sent30, failed: failed30, pending: counts['30d'].pending ?? 0, suppressed: suppressed30 },
    },
    topTemplates: topTemplates.map((t) => ({
      template: t.template,
      count: t._count.template,
    })),
    topErrors: topErrors.map((e) => ({
      error: e.lastError,
      count: e._count.lastError,
    })),
    averageAttempts: sentAgg._avg.attempts ?? 1,
    sent30d: sentAgg._count.attempts,
    deliverabilityRate: parseFloat(deliverabilityRate.toFixed(2)),
  })
}
