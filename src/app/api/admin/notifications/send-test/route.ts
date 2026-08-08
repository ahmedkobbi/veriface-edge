/**
 * POST /api/admin/notifications/send-test
 * Send a test email to verify SMTP/Resend/SES configuration.
 *
 * SECURITY FIX (I-5): Previously, this endpoint accepted any email address
 * in the `to` field — allowing an admin to send emails to arbitrary
 * recipients. This could be abused:
 *   - To send phishing emails from the platform's trusted domain
 *   - To spam arbitrary addresses (reputation damage)
 *   - To exfiltrate data via email (if template vars contained sensitive data)
 *
 * Now: the `to` field is RESTRICTED to:
 *   1. The admin's own email (default — no `to` field)
 *   2. Email addresses belonging to the same tenant's team members
 *
 * This prevents abuse while still allowing admins to test email delivery
 * to their team.
 *
 * Body: { to?: string } (optional — defaults to the admin's own email)
 * Returns: { success, message }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { enqueueEmail } from '@/lib/email-notifications'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const SendTestSchema = z.object({
  to: z.string().email().max(256).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json().catch(() => ({}))
  const validation = SendTestSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  // Default: send to the admin's own email
  let recipientEmail = validation.data.to ?? session.user.email

  // SECURITY FIX (I-5): If `to` is specified, verify it belongs to a
  // team member of the same tenant. This prevents sending to arbitrary addresses.
  if (validation.data.to && validation.data.to.toLowerCase() !== session.user.email.toLowerCase()) {
    const teamMember = await db.platformUser.findFirst({
      where: {
        email: validation.data.to.toLowerCase(),
        tenantId: session.tenantId,
      },
      select: { id: true, email: true },
    })

    if (!teamMember) {
      logger.warn(
        {
          requestedTo: validation.data.to,
          adminEmail: session.user.email,
          tenantId: session.tenantId,
        },
        'Test email rejected — recipient is not a team member',
      )
      return NextResponse.json(
        {
          success: false,
          error: 'Test emails can only be sent to your own address or team members of the same tenant.',
          code: 'RECIPIENT_NOT_ALLOWED',
        },
        { status: 403 },
      )
    }
    recipientEmail = teamMember.email
  }

  try {
    const result = await enqueueEmail({
      tenantId: session.tenantId,
      to: recipientEmail,
      userId: session.user.id,
      template: 'system.welcome',
      vars: {
        name: session.user.name ?? 'there',
        apiKey: 'vf_test_xxxxxxxxxxxx', // Fake test key — no real secret
        tenantId: session.tenantId,
      },
      bypassPreferences: true, // test email always sends
    })

    if (result.enqueued) {
      logger.info({ to: recipientEmail, emailId: result.emailId, requestedBy: session.user.id }, 'Test email enqueued')
      return NextResponse.json({
        success: true,
        message: `Test email sent to ${recipientEmail}`,
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
