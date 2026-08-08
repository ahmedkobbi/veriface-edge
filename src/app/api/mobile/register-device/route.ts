/**
 * POST /api/mobile/register-device
 * Register a mobile device for push notifications.
 *
 * Body: {
 *   pushToken: string,        — Expo push token
 *   platform: 'ios' | 'android',
 *   deviceName: string,
 *   appVersion: string,
 * }
 *
 * Stores the device token in NotificationPreference (or a new DeviceToken table).
 * The backend uses this to send push notifications via Expo Push API.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const RegisterDeviceSchema = z.object({
  pushToken: z.string().min(10),
  platform: z.enum(['ios', 'android']),
  deviceName: z.string().max(100).optional(),
  appVersion: z.string().max(20).optional(),
})

// In-memory device token store (production: Redis or DB table)
// Key: userId, Value: array of { pushToken, platform, deviceName, registeredAt }
const deviceTokens = new Map<string, Array<{
  pushToken: string
  platform: string
  deviceName: string
  registeredAt: number
}>>()

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json()
  const validation = RegisterDeviceSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.issues[0]?.message },
      { status: 400 },
    )
  }

  const { pushToken, platform, deviceName, appVersion } = validation.data

  // Store the device token
  const userDevices = deviceTokens.get(session.user.id) || []
  // Remove existing token (avoid duplicates on re-registration)
  const filtered = userDevices.filter(d => d.pushToken !== pushToken)
  filtered.push({
    pushToken,
    platform,
    deviceName: deviceName || 'Unknown',
    registeredAt: Date.now(),
  })
  deviceTokens.set(session.user.id, filtered)

  logger.info(
    { userId: session.user.id, platform, deviceCount: filtered.length },
    'Mobile device registered for push notifications',
  )

  return NextResponse.json({
    success: true,
    message: 'Device registered for push notifications',
    deviceCount: filtered.length,
  })
}

/**
 * GET /api/mobile/register-device
 * Returns the user's registered devices.
 */
export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const devices = deviceTokens.get(session.user.id) || []
  return NextResponse.json({ success: true, devices })
}

/**
 * Export the device tokens map for use by the notification sender.
 */
export function getDeviceTokens(userId: string): string[] {
  const devices = deviceTokens.get(userId) || []
  return devices.map(d => d.pushToken)
}

export function getAllDeviceTokens(): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [userId, devices] of deviceTokens) {
    result.set(userId, devices.map(d => d.pushToken))
  }
  return result
}
