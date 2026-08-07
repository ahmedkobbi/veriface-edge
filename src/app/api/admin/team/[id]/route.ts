/**
 * DELETE /api/admin/team/[id] — Remove a team member
 * PUT /api/admin/team/[id] — Change member role (user ↔ admin)
 *
 * Cannot remove yourself. Cannot remove the last admin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const RoleUpdateSchema = z.object({
  role: z.enum(['user', 'admin']),
})

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can remove members' }, { status: 403 })
  }

  const { id } = await params

  if (id === session.user.id) {
    return NextResponse.json({ success: false, error: 'Cannot remove yourself' }, { status: 400 })
  }

  const member = await db.platformUser.findFirst({
    where: { id, tenantId: session.tenantId },
  })

  if (!member) {
    return NextResponse.json({ success: false, error: 'Member not found' }, { status: 404 })
  }

  // Prevent removing the last admin
  if (member.role === 'admin') {
    const adminCount = await db.platformUser.count({
      where: { tenantId: session.tenantId, role: 'admin' },
    })
    if (adminCount <= 1) {
      return NextResponse.json({ success: false, error: 'Cannot remove the last admin' }, { status: 400 })
    }
  }

  // Detach from tenant (don't delete the account — they may have access to other tenants)
  await db.platformUser.update({
    where: { id },
    data: { tenantId: null },
  })

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: { action: 'member_removed', memberId: id, memberEmail: member.email },
  })

  logger.info({ removedMember: id, removedBy: session.user.id }, 'Team member removed')

  return NextResponse.json({ success: true, removed: true })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can change roles' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const validation = RoleUpdateSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const member = await db.platformUser.findFirst({
    where: { id, tenantId: session.tenantId },
  })

  if (!member) {
    return NextResponse.json({ success: false, error: 'Member not found' }, { status: 404 })
  }

  // Prevent demoting the last admin
  if (member.role === 'admin' && validation.data.role === 'user') {
    const adminCount = await db.platformUser.count({
      where: { tenantId: session.tenantId, role: 'admin' },
    })
    if (adminCount <= 1) {
      return NextResponse.json({ success: false, error: 'Cannot demote the last admin' }, { status: 400 })
    }
  }

  await db.platformUser.update({
    where: { id },
    data: { role: validation.data.role },
  })

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: { action: 'role_changed', memberId: id, oldRole: member.role, newRole: validation.data.role },
  })

  return NextResponse.json({ success: true, role: validation.data.role })
}
