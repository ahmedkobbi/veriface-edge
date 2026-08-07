/**
 * GET /api/customer/auth-history
 * Returns the authenticated user's biometric auth history (as a user, not admin).
 * Uses the session cookie to identify the platform user → their tenant → their externalUserId.
 *
 * Returns: list of auth attempts (timestamp, success/failure, liveness score, IP, device).
 * Also returns: security score (0-100), total auths, success rate.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // Get the platform user's email as their externalUserId in the biometric system
  const externalUserId = session.user.email

  // Find the biometric user
  const biometricUser = await db.user.findFirst({
    where: { tenantId: session.tenantId, externalUserId },
  })

  if (!biometricUser) {
    return NextResponse.json({
      success: true,
      enrolled: false,
      history: [],
      summary: { totalAuths: 0, successCount: 0, failureCount: 0, successRate: 0, securityScore: 50 },
    })
  }

  // Get auth events from audit log for this user
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const events = await db.auditLog.findMany({
    where: {
      tenantId: session.tenantId,
      createdAt: { gte: thirtyDaysAgo },
      eventType: { in: ['auth.success', 'auth.failure', 'enroll.success'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { eventType: true, payload: true, actorIp: true, createdAt: true },
  })

  // Filter to events mentioning this user
  const userEvents = events.filter((e) => {
    try {
      const payload = JSON.parse(e.payload)
      return payload.externalUserId === externalUserId || payload.sessionId
    } catch { return false }
  })

  const successCount = userEvents.filter((e) => e.eventType === 'auth.success').length
  const failureCount = userEvents.filter((e) => e.eventType === 'auth.failure').length
  const totalAuths = successCount + failureCount
  const successRate = totalAuths > 0 ? (successCount / totalAuths) * 100 : 100

  // Security score: 100 - (failures * 5) - (injection attempts * 20), clamped 0-100
  const injectionEvents = events.filter((e) => e.eventType === 'injection.suspected').length
  const securityScore = Math.max(0, Math.min(100, 100 - failureCount * 5 - injectionEvents * 20))

  // Check if template exists
  const template = await db.biometricTemplate.findFirst({
    where: { tenantId: session.tenantId, userId: biometricUser.id },
    select: { id: true, createdAt: true, lastUsedAt: true, modelVersion: true },
  })

  return NextResponse.json({
    success: true,
    enrolled: !!template,
    template: template ? {
      enrolledAt: template.createdAt,
      lastUsedAt: template.lastUsedAt,
      modelVersion: template.modelVersion,
    } : null,
    history: userEvents.map((e) => {
      let payload: any = {}
      try { payload = JSON.parse(e.payload) } catch {}
      return {
        eventType: e.eventType,
        timestamp: e.createdAt,
        ip: e.actorIp,
        livenessScore: payload.liveness?.overall,
        cosineSimilarity: payload.cosine,
      }
    }),
    summary: {
      totalAuths,
      successCount,
      failureCount,
      successRate: parseFloat(successRate.toFixed(1)),
      securityScore,
      last30Days: userEvents.length,
    },
  })
}
