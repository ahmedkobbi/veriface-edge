/**
 * POST /api/mobile/notifications/send
 * Send a push notification to a user's mobile devices.
 *
 * Internal endpoint (admin/cron only) — used by:
 *   - Security alert triggers (injection detected, brute force)
 *   - Billing alert triggers (payment failed, quota exceeded)
 *   - System alerts (service degraded, maintenance)
 *
 * Uses Expo Push API: https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Body: {
 *   userId: string,
 *   title: string,
 *   body: string,
 *   priority: 'critical' | 'high' | 'medium' | 'low',
 *   data?: object,
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDeviceTokens } from '../register-device/route'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const SendNotificationSchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  data: z.record(z.any()).optional(),
})

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export async function POST(req: NextRequest) {
  // Internal endpoint — requires admin session or CRON_SECRET
  const authHeader = req.headers.get('authorization')
  const cronSecret = req.headers.get('x-cron-secret')

  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    // Cron auth — OK
  } else {
    // Fall back to session auth
    const { requirePlatformSession } = await import('@/lib/platform-session')
    const session = await requirePlatformSession(req)
    if (!session.ok) return session.response
    if (session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }
  }

  const body = await req.json()
  const validation = SendNotificationSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message },
      { status: 400 },
    )
  }

  const { userId, title, body: messageBody, priority, data } = validation.data

  // Get the user's device tokens
  const tokens = getDeviceTokens(userId)
  if (tokens.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No registered devices — notification skipped',
      sentCount: 0,
    })
  }

  // Send push notification via Expo Push API
  const priorityMap: Record<string, 'default' | 'normal' | 'high'> = {
    critical: 'high',
    high: 'high',
    medium: 'default',
    low: 'normal',
  }

  const messages = tokens.map(token => ({
    to: token,
    title,
    body: messageBody,
    data: data || {},
    priority: priorityMap[priority] || 'default',
    sound: priority === 'critical' ? 'critical.wav' : 'default',
    badge: 1,
  }))

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(messages),
    })

    const result = await response.json()

    if (result.data) {
      const succeeded = result.data.filter((r: any) => r.status === 'ok').length
      const failed = result.data.filter((r: any) => r.status === 'error').length

      logger.info(
        { userId, tokens: tokens.length, succeeded, failed, priority },
        'Push notification sent',
      )

      return NextResponse.json({
        success: true,
        sentCount: succeeded,
        failedCount: failed,
      })
    }

    return NextResponse.json({ success: true, sentCount: 0 })
  } catch (e: any) {
    logger.error({ error: e, userId }, 'Failed to send push notification')
    return NextResponse.json(
      { success: false, error: 'Failed to send notification' },
      { status: 500 },
    )
  }
}
