/**
 * GET /api/admin/analytics
 * Analytics & insights: auth funnel, liveness score distribution,
 * device/platform breakdown, geographic distribution (by IP).
 * Protected by platform session cookie.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response
  const { tenantId } = session

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Auth funnel
  const sessionInits = await db.auditLog.count({
    where: { tenantId, eventType: 'session.init', createdAt: { gte: thirtyDaysAgo } },
  })
  const authSuccess = await db.auditLog.count({
    where: { tenantId, eventType: 'auth.success', createdAt: { gte: thirtyDaysAgo } },
  })
  const authFailure = await db.auditLog.count({
    where: { tenantId, eventType: 'auth.failure', createdAt: { gte: thirtyDaysAgo } },
  })

  // Get liveness scores from auth.success payloads
  const authEvents = await db.auditLog.findMany({
    where: { tenantId, eventType: 'auth.success', createdAt: { gte: thirtyDaysAgo } },
    select: { payload: true, actorIp: true },
    take: 500,
  })

  // Liveness score distribution
  const livenessBuckets = { '0-0.3': 0, '0.3-0.5': 0, '0.5-0.7': 0, '0.7-0.8': 0, '0.8-0.9': 0, '0.9-1.0': 0 }
  const ipSet = new Map<string, number>()

  for (const event of authEvents) {
    try {
      const payload = JSON.parse(event.payload)
      const score = payload.liveness?.overall ?? payload.cosine ?? 0
      if (score < 0.3) livenessBuckets['0-0.3']++
      else if (score < 0.5) livenessBuckets['0.3-0.5']++
      else if (score < 0.7) livenessBuckets['0.5-0.7']++
      else if (score < 0.8) livenessBuckets['0.7-0.8']++
      else if (score < 0.9) livenessBuckets['0.8-0.9']++
      else livenessBuckets['0.9-1.0']++

      if (event.actorIp && event.actorIp !== 'unknown') {
        ipSet.set(event.actorIp, (ipSet.get(event.actorIp) ?? 0) + 1)
      }
    } catch {}
  }

  // Top IPs (proxy for geography — full GeoIP would require a MaxMind DB)
  const topIps = Array.from(ipSet.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip: ip.slice(0, 8) + '...', count }))

  const funnel = {
    initiated: sessionInits,
    succeeded: authSuccess,
    failed: authFailure,
    conversionRate: sessionInits > 0 ? (authSuccess / sessionInits * 100).toFixed(1) : '0',
  }

  return NextResponse.json({
    success: true,
    funnel,
    livenessDistribution: livenessBuckets,
    topIps,
    totalUniqueIps: ipSet.size,
  })
}
