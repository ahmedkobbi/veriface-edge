/**
 * GET /api/admin/security
 * Security center: injection attempts, rate limit hits, suspicious IPs,
 * anti-injection defense status, recent security events.
 * Protected by platform session cookie.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response
  const { tenantId } = session

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // Security events from audit log
  const securityEvents = await db.auditLog.findMany({
    where: {
      tenantId,
      createdAt: { gte: sevenDaysAgo },
      eventType: {
        in: ['injection.suspected', 'auth.failure', 'rate_limit.exceeded', 'api_key.revoked', 'key.rotated', 'token.revoked'],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, eventType: true, payload: true, actorIp: true, createdAt: true },
  })

  // Aggregate suspicious IPs
  const ipMap = new Map<string, { failures: number; injections: number; lastSeen: Date }>()
  for (const event of securityEvents) {
    const ip = event.actorIp ?? 'unknown'
    if (!ipMap.has(ip)) ipMap.set(ip, { failures: 0, injections: 0, lastSeen: event.createdAt })
    const ipData = ipMap.get(ip)!
    ipData.lastSeen = event.createdAt > ipData.lastSeen ? event.createdAt : ipData.lastSeen
    if (event.eventType === 'auth.failure') ipData.failures++
    if (event.eventType === 'injection.suspected') ipData.injections++
  }

  const suspiciousIps = Array.from(ipMap.entries())
    .map(([ip, data]) => ({ ip, ...data }))
    .sort((a, b) => (b.failures + b.injections) - (a.failures + a.injections))
    .slice(0, 20)

  // Summary counts
  const injectionCount = securityEvents.filter((e) => e.eventType === 'injection.suspected').length
  const failureCount = securityEvents.filter((e) => e.eventType === 'auth.failure').length
  const rateLimitCount = securityEvents.filter((e) => e.eventType === 'rate_limit.exceeded').length
  const keyRotations = securityEvents.filter((e) => e.eventType === 'key.rotated').length

  return NextResponse.json({
    success: true,
    summary: {
      injectionAttempts: injectionCount,
      authFailures: failureCount,
      rateLimitHits: rateLimitCount,
      keyRotations,
      suspiciousIpCount: suspiciousIps.length,
    },
    suspiciousIps,
    recentEvents: securityEvents.slice(0, 20).map((e) => ({
      id: e.id,
      eventType: e.eventType,
      ip: e.actorIp,
      payload: JSON.parse(e.payload),
      timestamp: e.createdAt,
    })),
  })
}
