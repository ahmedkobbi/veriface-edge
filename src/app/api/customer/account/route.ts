/**
 * PUT /api/customer/account
 * Update account settings (password change, name change).
 *
 * Body:
 *   { action: "change_password", currentPassword, newPassword }
 *   { action: "update_name", name }
 *   { action: "delete_account" }
 *
 * DELETE /api/customer/account
 * Delete the platform user account entirely (detaches from tenant, clears cookie).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { hashPassword, verifyPassword, buildClearCookieHeader } from '@/lib/platform-auth'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const ChangePasswordSchema = z.object({
  action: z.literal('change_password'),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
})

const UpdateNameSchema = z.object({
  action: z.literal('update_name'),
  name: z.string().min(1).max(256),
})

const DeleteAccountSchema = z.object({
  action: z.literal('delete_account'),
  confirm: z.literal(true),
})

export async function PUT(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json()

  // Handle change_password
  if (body.action === 'change_password') {
    const validation = ChangePasswordSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
    }

    const user = await db.platformUser.findUnique({ where: { id: session.user.id } })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })

    const valid = await verifyPassword(validation.data.currentPassword, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Current password is incorrect' }, { status: 401 })
    }

    const newHash = await hashPassword(validation.data.newPassword)
    await db.platformUser.update({
      where: { id: session.user.id },
      data: { passwordHash: newHash },
    })

    await appendAudit({
      tenantId: session.tenantId,
      eventType: 'key.rotated',
      payload: { action: 'password_changed', userId: session.user.id },
    })

    logger.info({ userId: session.user.id }, 'Customer changed password')

    return NextResponse.json({ success: true, message: 'Password updated' })
  }

  // Handle update_name
  if (body.action === 'update_name') {
    const validation = UpdateNameSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
    }

    await db.platformUser.update({
      where: { id: session.user.id },
      data: { name: validation.data.name },
    })

    return NextResponse.json({ success: true, message: 'Name updated' })
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // Detach from tenant (don't hard-delete — audit trail needs the record)
  await db.platformUser.update({
    where: { id: session.user.id },
    data: {
      tenantId: null,
      passwordHash: 'deleted_account',
      name: null,
    },
  })

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: { action: 'account_deleted', userId: session.user.id },
  })

  logger.info({ userId: session.user.id }, 'Customer deleted account')

  const response = NextResponse.json({ success: true, message: 'Account deleted' })
  response.headers.set('Set-Cookie', buildClearCookieHeader())
  return response
}
