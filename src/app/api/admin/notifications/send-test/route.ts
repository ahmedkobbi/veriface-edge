/**
 * POST /api/admin/notifications/send-test
 * Send a test email to verify SMTP/Resend/SES configuration.
 *
 * Body: { to?: string } (defaults to the admin's own email)
 *
 * Returns: { success, message }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { enqueueEmail } from '@/lib/email-notifications'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const SendTestSchema = z.object({
  to: z.string().email().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json().catch(() => ({}))
  const validation = SendTestSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const to = validation.data.to ?? session.user.email

  try {
    const result = await enqueueEmail({
      tenantId: session.tenantId,
      to,
      userId: session.user.id,
      template: 'system.welcome',
      vars: {
        name: session.user.name ?? 'there',
        apiKey: 'vf_test_xxxxxxxxxxxx',
        tenantId: session.tenantId,
      },
      bypassPreferences: true, // test email always sends
    })

    if (result.enqueued) {
      logger.info({ to, emailId: result.emailId }, 'Test email enqueued')
      return NextResponse.json({
        success: true,
        message: `Test email sent to ${to}`,
        emailId: result.emailId,
      })
    }

    return NextResponse.json({
      success: false,
      message: `Test email not sent: ${result.reason}`,
    })
  } catch (e) {
    logger.error({ error: e }, 'Failed to send test email')
    return NextResponse.json({ success: false, error: 'Failed to send test email' }, { status: 500 })
  }
}
