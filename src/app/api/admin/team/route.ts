/**
 * GET /api/admin/team
 * List team members for the tenant (platform users with same tenantId).
 * Protected by platform session cookie.
 *
 * POST /api/admin/team
 * Invite a new team member (creates a PlatformUser with a temp password).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { hashPassword } from '@/lib/platform-auth'
import { safeErrorResponse } from '@/lib/config'
import { logger } from '@/lib/logger'
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

  // Generate a random temporary password (user must change on first login)
  const tempPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 16) + 'A1!'
  const passwordHash = await hashPassword(tempPassword)

  const member = await db.platformUser.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      name,
      role,
      tenantId: session.tenantId,
    },
  })

  logger.info({ invitedEmail: email, invitedBy: session.user.id }, 'Team member invited')

  return NextResponse.json({
    success: true,
    member: {
      id: member.id,
      email: member.email,
      name: member.name,
      role: member.role,
      createdAt: member.createdAt,
    },
    tempPassword, // Shown once — must be communicated securely to the invitee
    warning: 'Communicate this temporary password to the invitee securely. They should change it on first login.',
  })
}
