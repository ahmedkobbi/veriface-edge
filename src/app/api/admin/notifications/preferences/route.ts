/**
 * GET /api/admin/notifications/preferences
 * Returns the current user's notification preferences (DB-backed, with sensible defaults).
 *
 * PUT /api/admin/notifications/preferences
 * Updates the user's notification preferences.
 *
 * Categories:
 *   authAlerts      — new device, password change, 2FA change
 *   securityAlerts  — injection, brute force, suspicious activity
 *   billingAlerts   — threshold, limit reached, spending alert
 *   productUpdates  — new features, changelog
 *   weeklyDigest    — weekly usage summary
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { getUserPreferences, setUserPreferences } from '@/lib/email-notifications'
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
  return NextResponse.json({ success: true, preferences: prefs })
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
