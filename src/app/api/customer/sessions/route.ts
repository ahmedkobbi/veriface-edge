/**
 * GET /api/customer/sessions
 * List active sessions for the current user (based on audit log activity).
 *
 * Returns: list of devices/browsers that have authenticated recently,
 * with IP, timestamp, and a "revoke" capability (clears all sessions
 * by rotating the server signing key — forces re-login everywhere).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // Get recent auth activity for this user
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const events = await db.auditLog.findMany({
    where: {
      tenantId: session.tenantId,
      createdAt: { gte: sevenDaysAgo },
      eventType: { in: ['auth.success', 'auth.failure', 'session.init'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { eventType: true, payload: true, actorIp: true, createdAt: true },
  })

  // Extract unique IPs with last-seen timestamps
  const sessionMap = new Map<string, { ip: string; lastSeen: Date; authCount: number; failures: number }>()
  for (const event of events) {
    const ip = event.actorIp ?? 'unknown'
    if (ip === 'unknown') continue
    if (!sessionMap.has(ip)) {
      sessionMap.set(ip, { ip, lastSeen: event.createdAt, authCount: 0, failures: 0 })
    }
    const s = sessionMap.get(ip)!
    s.lastSeen = event.createdAt > s.lastSeen ? event.createdAt : s.lastSeen
    if (event.eventType === 'auth.success') s.authCount++
    if (event.eventType === 'auth.failure') s.failures++
  }

  const sessions = Array.from(sessionMap.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())

  return NextResponse.json({
    success: true,
    sessions,
    currentIp: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
  })
}
