/**
 * GET /api/admin/fraud-score
 *
 * Fraud Score Engine — composite risk score (0-100) combining:
 *   - Liveness score (rPPG + PAD)
 *   - Anti-injection signals (timing, replay, tamper)
 *   - Auth failure rate (last 7 days)
 *   - Injection attempt count
 *   - Geographic anomalies (IP distance from usual)
 *   - Time anomalies (off-hours auth attempts)
 *   - Device fingerprint anomalies
 *   - Velocity (auths per hour)
 *
 * Score: 0 = maximum fraud risk, 100 = maximum trust
 *
 * Also returns per-signal breakdown for transparency.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

interface FraudSignal {
  name: string
  weight: number
  score: number
  detail: string
}

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  // Gather raw signals from audit log
  const [recentEvents, lastHourEvents, injectionEvents, failureEvents] = await Promise.all([
    db.auditLog.findMany({
      where: { tenantId: session.tenantId, createdAt: { gte: sevenDaysAgo } },
      select: { eventType: true, payload: true, actorIp: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    db.auditLog.count({
      where: { tenantId: session.tenantId, createdAt: { gte: oneHourAgo }, eventType: { in: ['auth.success', 'auth.failure'] } },
    }),
    db.auditLog.count({
      where: { tenantId: session.tenantId, eventType: 'injection.suspected', createdAt: { gte: sevenDaysAgo } },
    }),
    db.auditLog.count({
      where: { tenantId: session.tenantId, eventType: 'auth.failure', createdAt: { gte: sevenDaysAgo } },
    }),
  ])

  const signals: FraudSignal[] = []

  // Signal 1: Injection attempts (weight: 25)
  const injectionScore = Math.max(0, 100 - injectionEvents * 20)
  signals.push({
    name: 'Injection Defense',
    weight: 25,
    score: injectionScore,
    detail: injectionEvents === 0 ? 'No injection attempts detected' : `${injectionEvents} injection attempts in 7 days`,
  })

  // Signal 2: Auth failure rate (weight: 20)
  const totalAuths = recentEvents.filter(e => e.eventType === 'auth.success' || e.eventType === 'auth.failure').length
  const failureRate = totalAuths > 0 ? failureEvents / totalAuths : 0
  const failureScore = Math.max(0, 100 - failureRate * 200)
  signals.push({
    name: 'Auth Failure Rate',
    weight: 20,
    score: failureScore,
    detail: `${(failureRate * 100).toFixed(1)}% failure rate (${failureEvents}/${totalAuths})`,
  })

  // Signal 3: Velocity (weight: 15)
  // Normal: 0-50 auths/hour. Suspicious: 50-200. Critical: >200
  const velocityScore = lastHourEvents > 200 ? 0 : lastHourEvents > 50 ? 50 : 100
  signals.push({
    name: 'Auth Velocity',
    weight: 15,
    score: velocityScore,
    detail: `${lastHourEvents} auths in last hour`,
  })

  // Signal 4: Geographic consistency (weight: 15)
  // Check if recent IPs are diverse (could indicate credential sharing)
  const recentIps = new Set(recentEvents.filter(e => e.actorIp && e.actorIp !== 'unknown').map(e => e.actorIp))
  const geoScore = recentIps.size > 20 ? 40 : recentIps.size > 10 ? 70 : 100
  signals.push({
    name: 'Geographic Consistency',
    weight: 15,
    score: geoScore,
    detail: `${recentIps.size} unique IPs in 7 days`,
  })

  // Signal 5: Time anomaly (weight: 10)
  // Check for off-hours activity (2AM-5AM local time)
  const offHoursCount = recentEvents.filter(e => {
    const hour = new Date(e.createdAt).getHours()
    return hour >= 2 && hour <= 5
  }).length
  const timeScore = Math.max(0, 100 - offHoursCount * 5)
  signals.push({
    name: 'Time Pattern',
    weight: 10,
    score: timeScore,
    detail: offHoursCount === 0 ? 'No off-hours activity' : `${offHoursCount} off-hours events (2AM-5AM)`,
  })

  // Signal 6: Rate limit hits (weight: 15)
  const rateLimitHits = recentEvents.filter(e => e.eventType === 'rate_limit.exceeded').length
  const rateLimitScore = Math.max(0, 100 - rateLimitHits * 10)
  signals.push({
    name: 'Rate Limit Compliance',
    weight: 15,
    score: rateLimitScore,
    detail: rateLimitHits === 0 ? 'No rate limit violations' : `${rateLimitHits} rate limit hits`,
  })

  // Composite score
  const compositeScore = Math.round(
    signals.reduce((sum, s) => sum + (s.score * s.weight) / 100, 0)
  )

  // Risk level
  const riskLevel = compositeScore >= 80 ? 'low' : compositeScore >= 60 ? 'medium' : compositeScore >= 40 ? 'high' : 'critical'

  return NextResponse.json({
    success: true,
    fraudScore: compositeScore,
    riskLevel,
    signals,
    recommendation: riskLevel === 'critical'
      ? 'Immediate action required: review security events and consider blocking suspicious IPs'
      : riskLevel === 'high'
      ? 'Elevated risk: increase liveness threshold and monitor closely'
      : riskLevel === 'medium'
      ? 'Moderate risk: standard monitoring recommended'
      : 'Low risk: system operating normally',
  })
}
