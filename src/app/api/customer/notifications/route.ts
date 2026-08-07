/**
 * GET /api/customer/notifications
 * Returns notification preferences + recent notifications for the user.
 *
 * PUT /api/customer/notifications
 * Update notification preferences.
 *
 * Notifications are sourced from the EmailLog table (real emails sent/received).
 * Preferences are stored in the NotificationPreference table.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import {
  getUserPreferences,
  setUserPreferences,
} from '@/lib/email-notifications'
import { db } from '@/lib/db'
import { z } from 'zod'

const PrefsSchema = z.object({
  authAlerts: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  billingAlerts: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const prefs = await getUserPreferences(session.user.id)

  // Fetch the user's recent emails (sent to their address)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const user = await db.platformUser.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  })

  const emails = user
    ? await db.emailLog.findMany({
        where: {
          tenantId: session.tenantId,
          toAddress: user.email,
          createdAt: { gte: sevenDaysAgo },
          state: { in: ['sent', 'suppressed'] }, // don't show pending/failed
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          template: true,
          subject: true,
          state: true,
          createdAt: true,
          sentAt: true,
        },
      })
    : []

  const notifications = emails.map((e) => ({
    id: e.id,
    template: e.template,
    type: getNotificationType(e.template),
    subject: e.subject,
    message: getNotificationMessage(e.template),
    timestamp: e.sentAt ?? e.createdAt,
    read: false, // read state would require a separate table
  }))

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

  const updated = await setUserPreferences(session.user.id, session.tenantId, validation.data)
  return NextResponse.json({ success: true, preferences: updated })
}

function getNotificationType(template: string): 'auth' | 'security' | 'billing' | 'product' {
  if (template.startsWith('auth.')) return 'auth'
  if (template.startsWith('security.')) return 'security'
  if (template.startsWith('billing.')) return 'billing'
  return 'product'
}

function getNotificationMessage(template: string): string {
  const messages: Record<string, string> = {
    'auth.new_device': 'New device signed in to your account',
    'auth.failed_login': 'Multiple failed login attempts detected',
    'auth.password_changed': 'Your password was changed',
    'auth.two_factor_enabled': 'Two-factor authentication enabled',
    'auth.two_factor_disabled': 'Two-factor authentication disabled',
    'billing.threshold': 'Monthly usage threshold reached',
    'billing.limit_reached': 'Monthly API quota exhausted',
    'billing.spending_alert': 'Spending limit alert',
    'security.api_key_created': 'New API key created',
    'security.api_key_revoked': 'API key revoked',
    'security.injection_detected': 'Presentation attack detected',
    'security.suspicious_activity': 'Suspicious activity detected',
    'system.welcome': 'Welcome to VeriFace Edge',
    'system.email_verification': 'Email verification',
    'system.password_reset': 'Password reset request',
  }
  return messages[template] ?? template
}
