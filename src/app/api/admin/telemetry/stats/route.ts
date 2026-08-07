/**
 * GET /api/admin/telemetry/stats
 * Returns aggregate telemetry stats:
 *   - Total events (24h, 7d, 30d)
 *   - Top error codes
 *   - Top stages
 *   - Browser/OS breakdown
 *   - WebGPU adoption rate
 *   - Error trend (last 14 days, per-day)
 *
 * Used by the admin Telemetry dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { sha256Hex } from '@/lib/crypto-server'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // Hash the tenantId the same way the ingestion endpoint does
  const tenantIdHash = sha256Hex(session.tenantId)

  const now = Date.now()
  const ranges = {
    '24h': new Date(now - 24 * 60 * 60 * 1000),
    '7d': new Date(now - 7 * 24 * 60 * 60 * 1000),
    '30d': new Date(now - 30 * 24 * 60 * 60 * 1000),
  }

  // Counts by severity for each range
  const counts: Record<string, Record<string, number>> = {}
  for (const [range, since] of Object.entries(ranges)) {
    const rows = await db.sdkErrorEvent.groupBy({
      by: ['severity'],
      where: { tenantIdHash, createdAt: { gte: since } },
      _count: { severity: true },
    })
    counts[range] = {}
    for (const r of rows) counts[range][r.severity] = r._count.severity
  }

  // Top error codes (30d)
  const topErrorCodes = await db.sdkErrorEvent.groupBy({
    by: ['errorCode'],
    where: { tenantIdHash, createdAt: { gte: ranges['30d'] } },
    _count: { errorCode: true },
    orderBy: { _count: { errorCode: 'desc' } },
    take: 10,
  })

  // Top stages (30d)
  const topStages = await db.sdkErrorEvent.groupBy({
    by: ['stage'],
    where: { tenantIdHash, createdAt: { gte: ranges['30d'] } },
    _count: { stage: true },
    orderBy: { _count: { stage: 'desc' } },
    take: 10,
  })

  // Browser breakdown (30d)
  const browserBreakdown = await db.sdkErrorEvent.groupBy({
    by: ['browserFamily'],
    where: { tenantIdHash, createdAt: { gte: ranges['30d'] } },
    _count: { browserFamily: true },
    orderBy: { _count: { browserFamily: 'desc' } },
  })

  // OS breakdown (30d)
  const osBreakdown = await db.sdkErrorEvent.groupBy({
    by: ['osFamily'],
    where: { tenantIdHash, createdAt: { gte: ranges['30d'] } },
    _count: { osFamily: true },
    orderBy: { _count: { osFamily: 'desc' } },
  })

  // WebGPU adoption (30d)
  const webgpuStats = await db.sdkErrorEvent.groupBy({
    by: ['hasWebGPU'],
    where: { tenantIdHash, createdAt: { gte: ranges['30d'] } },
    _count: { hasWebGPU: true },
  })
  const total30d = (counts['30d'].fatal ?? 0) + (counts['30d'].error ?? 0) + (counts['30d'].warning ?? 0)
  const webgpuTrue = webgpuStats.find((w) => w.hasWebGPU === true)?._count.hasWebGPU ?? 0
  const webgpuAdoptionRate = total30d > 0 ? (webgpuTrue / total30d) * 100 : 0

  // SDK version breakdown (30d)
  const sdkVersions = await db.sdkErrorEvent.groupBy({
    by: ['sdkVersion'],
    where: { tenantIdHash, createdAt: { gte: ranges['30d'] } },
    _count: { sdkVersion: true },
    orderBy: { _count: { sdkVersion: 'desc' } },
    take: 5,
  })

  // Error trend (last 14 days, per-day)
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000)
  const trendEntries = await db.sdkErrorEvent.findMany({
    where: { tenantIdHash, createdAt: { gte: fourteenDaysAgo } },
    select: { createdAt: true, severity: true },
    orderBy: { createdAt: 'asc' },
  })
  const trendMap = new Map<string, { fatal: number; error: number; warning: number }>()
  for (const entry of trendEntries) {
    const day = entry.createdAt.toISOString().slice(0, 10)
    if (!trendMap.has(day)) trendMap.set(day, { fatal: 0, error: 0, warning: 0 })
    const dayData = trendMap.get(day)!
    dayData[entry.severity as 'fatal' | 'error' | 'warning']++
  }
  const trend = Array.from(trendMap.entries()).map(([date, data]) => ({ date, ...data }))

  return NextResponse.json({
    success: true,
    counts: {
      '24h': {
        fatal: counts['24h'].fatal ?? 0,
        error: counts['24h'].error ?? 0,
        warning: counts['24h'].warning ?? 0,
        total: (counts['24h'].fatal ?? 0) + (counts['24h'].error ?? 0) + (counts['24h'].warning ?? 0),
      },
      '7d': {
        fatal: counts['7d'].fatal ?? 0,
        error: counts['7d'].error ?? 0,
        warning: counts['7d'].warning ?? 0,
        total: (counts['7d'].fatal ?? 0) + (counts['7d'].error ?? 0) + (counts['7d'].warning ?? 0),
      },
      '30d': {
        fatal: counts['30d'].fatal ?? 0,
        error: counts['30d'].error ?? 0,
        warning: counts['30d'].warning ?? 0,
        total: total30d,
      },
    },
    topErrorCodes: topErrorCodes.map((e) => ({ code: e.errorCode, count: e._count.errorCode })),
    topStages: topStages.map((s) => ({ stage: s.stage, count: s._count.stage })),
    browserBreakdown: browserBreakdown.map((b) => ({ family: b.browserFamily, count: b._count.browserFamily })),
    osBreakdown: osBreakdown.map((o) => ({ family: o.osFamily, count: o._count.osFamily })),
    sdkVersions: sdkVersions.map((v) => ({ version: v.sdkVersion, count: v._count.sdkVersion })),
    webgpuAdoptionRate: parseFloat(webgpuAdoptionRate.toFixed(1)),
    trend,
  })
}
