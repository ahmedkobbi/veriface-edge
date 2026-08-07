/**
 * GET /api/admin/templates/[id] — Individual template detail
 * DELETE /api/admin/templates/[id] — Purge a specific template (GDPR Art. 17)
 *
 * Returns full metadata: commitment, model version, variant, norm,
 * created/last-used dates, associated user info. Does NOT return
 * the encrypted embedding (security: never expose to admin UI).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { revokeTemplate } from '@/lib/tenant'
import { appendAudit } from '@/lib/audit'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const { id } = await params

  const template = await db.biometricTemplate.findFirst({
    where: { id, tenantId: session.tenantId },
    include: {
      user: {
        select: { id: true, externalUserId: true, createdAt: true },
      },
    },
  })

  if (!template) {
    return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    template: {
      id: template.id,
      commitment: template.commitment,
      modelVersion: template.modelVersion,
      variant: template.variant,
      norm: template.norm,
      createdAt: template.createdAt,
      lastUsedAt: template.lastUsedAt,
      user: {
        id: template.user.id,
        externalUserId: template.user.externalUserId,
        userCreatedAt: template.user.createdAt,
      },
    },
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can purge templates' }, { status: 403 })
  }

  const { id } = await params

  const template = await db.biometricTemplate.findFirst({
    where: { id, tenantId: session.tenantId },
    include: { user: { select: { externalUserId: true } } },
  })

  if (!template) {
    return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 })
  }

  const result = await revokeTemplate(session.tenantId, template.user.externalUserId)

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'template.revoked',
    payload: {
      templateId: id,
      externalUserId: template.user.externalUserId,
      deletedBy: session.user.id,
      receipt: result.revocationReceipt,
    },
  })

  return NextResponse.json({
    success: true,
    deleted: result.deleted,
    revocationReceipt: result.revocationReceipt,
  })
}
