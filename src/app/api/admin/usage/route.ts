/**
 * GET /api/admin/usage
 * Returns usage metrics: auth counts, cost tracking, daily breakdown.
 * Protected by platform session cookie.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

const PRICE_PER_AUTH = 0.08

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response
  const { tenantId } = session

  // Get last 30 days of audit entries
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const entries = await db.auditLog.findMany({
    where: { tenantId, createdAt: { gte: thirtyDaysAgo } },
    select: { eventType: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  // Count by type
  const authSuccess = entries.filter((e) => e.eventType === 'auth.success').length
  const authFailure = entries.filter((e) => e.eventType === 'auth.failure').length
  const enrollments = entries.filter((e) => e.eventType === 'enroll.success').length
  const injections = entries.filter((e) => e.eventType === 'injection.suspected').length
  const rateLimited = entries.filter((e) => e.eventType === 'rate_limit.exceeded').length

  // Daily breakdown (last 14 days)
  const dailyMap = new Map<string, { auths: number; enrollments: number; failures: number }>()
  for (const entry of entries) {
    const day = entry.createdAt.toISOString().slice(0, 10)
    if (!dailyMap.has(day)) dailyMap.set(day, { auths: 0, enrollments: 0, failures: 0 })
    const dayData = dailyMap.get(day)!
    if (entry.eventType === 'auth.success') dayData.auths++
    if (entry.eventType === 'enroll.success') dayData.enrollments++
    if (entry.eventType === 'auth.failure') dayData.failures++
  }

  const daily = Array.from(dailyMap.entries()).map(([date, data]) => ({ date, ...data }))

  // Cost calculation
  const totalBillableAuths = authSuccess + enrollments
  const estimatedCost = totalBillableAuths * PRICE_PER_AUTH

  // Active API keys count
  const activeKeys = await db.apiKey.count({ where: { tenantId, active: true } })

  // Enrolled users count
  const enrolledUsers = await db.user.count({ where: { tenantId } })

  return NextResponse.json({
    success: true,
    summary: {
      authSuccess,
      authFailure,
      enrollments,
      injections,
      rateLimited,
      activeKeys,
      enrolledUsers,
      estimatedCost: parseFloat(estimatedCost.toFixed(2)),
      pricePerAuth: PRICE_PER_AUTH,
    },
    daily,
  })
}
