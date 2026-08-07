/**
 * GET /api/customer/notifications
 * Returns notification preferences + recent notifications for the user.
 *
 * PUT /api/customer/notifications
 * Update notification preferences.
 *
 * Notifications are derived from audit log events — no separate table needed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { z } from 'zod'

// In-memory notification preferences (production: DB or Redis)
const notifPrefs = new Map<string, {
  authAlerts: boolean
  securityAlerts: boolean
  billingAlerts: boolean
  productUpdates: boolean
}>()

const defaultPrefs = {
  authAlerts: true,
  securityAlerts: true,
  billingAlerts: true,
  productUpdates: false,
}

const PrefsSchema = z.object({
  authAlerts: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  billingAlerts: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const prefs = notifPrefs.get(session.user.id) ?? defaultPrefs

  // Generate notifications from recent audit events
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const events = await db.auditLog.findMany({
    where: {
      tenantId: session.tenantId,
      createdAt: { gte: sevenDaysAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { eventType: true, payload: true, createdAt: true },
  })

  const notifications = events.map((e) => {
    let payload: any = {}
    try { payload = JSON.parse(e.payload) } catch {}
    const isSecurity = ['injection.suspected', 'auth.failure', 'rate_limit.exceeded'].includes(e.eventType)
    const isBilling = ['enroll.success'].includes(e.eventType)
    return {
      id: e.createdAt.getTime().toString(),
      type: isSecurity ? 'security' : isBilling ? 'billing' : 'auth',
      eventType: e.eventType,
      message: getNotificationMessage(e.eventType, payload),
      timestamp: e.createdAt,
      read: false,
    }
  }).filter((n) => {
    if (n.type === 'security' && !prefs.securityAlerts) return false
    if (n.type === 'billing' && !prefs.billingAlerts) return false
    if (n.type === 'auth' && !prefs.authAlerts) return false
    return true
  })

  return NextResponse.json({
    success: true,
    preferences: prefs,
    notifications,
    unreadCount: notifications.length,
  })
}

export async function PUT(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json()
  const validation = PrefsSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const current = notifPrefs.get(session.user.id) ?? defaultPrefs
  const updated = { ...current, ...validation.data }
  notifPrefs.set(session.user.id, updated)

  return NextResponse.json({ success: true, preferences: updated })
}

function getNotificationMessage(eventType: string, payload: any): string {
  switch (eventType) {
    case 'auth.success': return `Authentication successful (liveness: ${payload.liveness?.overall ? (payload.liveness.overall * 100).toFixed(0) + '%' : 'N/A'})`
    case 'auth.failure': return `Authentication failed: ${payload.reason ?? 'unknown'}`
    case 'enroll.success': return 'Biometric template enrolled successfully'
    case 'injection.suspected': return `Security alert: ${payload.reasons?.join(', ') ?? 'injection detected'}`
    case 'rate_limit.exceeded': return 'Rate limit exceeded — possible abuse detected'
    case 'template.revoked': return 'Your biometric template was deleted'
    case 'key.rotated': return 'Tenant signing key was rotated'
    default: return eventType
  }
}
