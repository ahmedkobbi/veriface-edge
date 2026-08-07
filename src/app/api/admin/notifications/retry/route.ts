/**
 * POST /api/admin/notifications/retry
 * Retry a failed email manually (reset attempts + schedule immediate send).
 *
 * Body: { emailId: string }
 *
 * Returns: { success, message }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { processEmailEntry } from '@/lib/email-notifications'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const RetrySchema = z.object({
  emailId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json().catch(() => ({}))
  const validation = RetrySchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { emailId } = validation.data

  // Verify ownership (email belongs to this tenant)
  const entry = await db.emailLog.findUnique({
    where: { id: emailId },
    select: { id: true, tenantId: true, state: true, attempts: true, maxAttempts: true },
  })

  if (!entry || entry.tenantId !== session.tenantId) {
    return NextResponse.json({ success: false, error: 'Email not found' }, { status: 404 })
  }

  if (entry.state === 'sent') {
    return NextResponse.json({ success: false, error: 'Email already sent' }, { status: 400 })
  }

  // Reset attempts + schedule immediate retry
  await db.emailLog.update({
    where: { id: emailId },
    data: {
      state: 'pending',
      attempts: 0, // reset so it gets a full retry budget
      nextRetryAt: new Date(),
      lastError: null,
    },
  })

  // Try immediate send (async, non-blocking)
  void processEmailEntry(emailId).catch((e) => {
    logger.warn({ error: e, emailId }, 'Manual retry send failed (will be retried by cron)')
  })

  logger.info({ emailId, tenantId: session.tenantId }, 'Email retry scheduled manually')

  return NextResponse.json({
    success: true,
    message: 'Email retry scheduled',
  })
}
