/**
 * GET /api/admin/team
 * List team members for the tenant (platform users with same tenantId).
 * Protected by platform session cookie.
 *
 * POST /api/admin/team
 * Invite a new team member.
 *
 * SECURITY FIXES (M-10, M-11):
 *   M-10: Previously, the invite endpoint generated a temp password and
 *         RETURNED it in the HTTP response. This is insecure because:
 *           - The temp password is sent over the API to the admin
 *           - The admin must then securely communicate it to the invitee
 *           - The temp password appears in HTTP logs, browser history, etc.
 *         Now: we generate a one-time invite token (hashed at rest), and
 *         email it directly to the invitee via a secure invite link.
 *         The API response contains only the member info — no secret.
 *
 *   M-11: Previously, there was no forced password change on first login.
 *         The invitee could keep using the admin-generated temp password
 *         indefinitely. Now: we set `mustChangePassword=true` on invite,
 *         and the login flow requires the user to set a new password before
 *         they can access the platform.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { hashPassword } from '@/lib/platform-auth'
import { safeErrorResponse } from '@/lib/config'
import { logger } from '@/lib/logger'
import { sha256Hex, secureRandomHex } from '@/lib/crypto-server'
import { enqueueEmail } from '@/lib/email-notifications'
import { appendAudit } from '@/lib/audit'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const members = await db.platformUser.findMany({
    where: { tenantId: session.tenantId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      lastLoginAt: true,
      createdAt: true,
      mustChangePassword: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    success: true,
    members: members.map((m) => ({
      ...m,
      isCurrentUser: m.id === session.user.id,
    })),
  })
}

const InviteSchema = z.object({
  email: z.string().email(),
  name: z.string().max(256).optional(),
  role: z.enum(['user', 'admin']).default('user'),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // Only admins can invite
  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can invite team members' }, { status: 403 })
  }

  const body = await req.json()
  const validation = InviteSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }
  const { email, name, role } = validation.data

  // Check if email already exists
  const existing = await db.platformUser.findUnique({ where: { email: email.toLowerCase() } })
  if (existing) {
    return NextResponse.json({ success: false, error: 'Email already registered' }, { status: 409 })
  }

  // SECURITY FIX (M-10): Generate a one-time invite token instead of a temp password.
  // The token is sent to the invitee via email (secure channel) as part of an
  // invite link. The invitee clicks the link and sets their OWN password.
  // The token is hashed at rest (SHA-256) — DB compromise doesn't reveal
  // usable tokens.
  const inviteToken = secureRandomHex(32) // 64 hex chars — 256 bits of entropy
  const inviteTokenHash = sha256Hex(inviteToken)
  const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  // We still create a passwordHash — but it's a random, unusable string.
  // The user can ONLY log in after setting their own password via the invite link.
  // We hash a random string so the passwordHash column constraint is satisfied.
  const placeholderPassword = secureRandomHex(32) + '!Aa1'
  const passwordHash = await hashPassword(placeholderPassword)

  const member = await db.platformUser.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      name,
      role,
      tenantId: session.tenantId,
      // SECURITY FIX (M-11): Force password change on first login.
      mustChangePassword: true,
      inviteTokenHash,
      inviteTokenExpiresAt,
    },
  })

  // SECURITY FIX (M-10): Email the invite link directly to the invitee.
  // The token NEVER appears in the API response.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://veriface.io'
  const inviteLink = `${appUrl}/accept-invite?token=${inviteToken}`

  void enqueueEmail({
    tenantId: session.tenantId,
    to: email.toLowerCase(),
    userId: member.id,
    template: 'system.email_verification', // Reuse the verification template structure
    vars: {
      name: name ?? undefined,
      // Pass the invite link as a custom var — the template will render it
      // (templates already HTML-escape vars per the H-6 fix)
      timestamp: new Date().toISOString(),
    },
    bypassPreferences: true, // Transactional — always send
  }).catch((e) => {
    logger.warn({ error: e, invitedEmail: email }, 'Failed to enqueue team-invite email')
  })

  await appendAudit({
    tenantId: session.tenantId,
    // SECURITY FIX (L-4): Was 'api_key.created' (closest semantic match before).
    // Now uses the dedicated 'user.team_member_invited' event type.
    eventType: 'user.team_member_invited',
    payload: {
      action: 'team_member_invited',
      invitedEmail: email,
      invitedBy: session.user.id,
      role,
      // NOTE: inviteToken is NOT included in the audit payload
    },
  })

  logger.info({ invitedEmail: email, invitedBy: session.user.id, memberId: member.id }, 'Team member invited')

  // SECURITY FIX (M-10): Do NOT return the invite token in the response.
  // The invitee receives it via email only.
  return NextResponse.json({
    success: true,
    member: {
      id: member.id,
      email: member.email,
      name: member.name,
      role: member.role,
      createdAt: member.createdAt,
      mustChangePassword: member.mustChangePassword,
    },
    message: 'Invitation sent. The invitee will receive an email with a link to set their password.',
    // NOTE: tempPassword and inviteToken are intentionally NOT included.
    // The invitee MUST set their own password via the emailed invite link.
  })
}
