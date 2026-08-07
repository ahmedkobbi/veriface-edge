/**
 * GET /api/admin/compliance/dsr — List Data Subject Requests
 * POST /api/admin/compliance/dsr — Create a DSR (GDPR Art. 15/17/20)
 * PUT /api/admin/compliance/dsr — Resolve a DSR
 *
 * DSR types:
 *   - access (Art. 15) — User requests their data
 *   - erasure (Art. 17) — User requests deletion
 *   - portability (Art. 20) — User requests data export
 *   - objection (Art. 21) — User objects to processing
 *
 * DSR status: pending → in_progress → resolved | rejected
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { revokeTemplate } from '@/lib/tenant'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const DsrCreateSchema = z.object({
  externalUserId: z.string().min(1).max(256),
  requestType: z.enum(['access', 'erasure', 'portability', 'objection']),
  notes: z.string().max(1024).optional(),
})

const DsrResolveSchema = z.object({
  dsrId: z.string(),
  status: z.enum(['in_progress', 'resolved', 'rejected']),
  resolution: z.string().max(1024).optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // DSRs are stored as audit log entries with eventType 'consent.recorded'
  // and payload.dsr = true. We query and filter.
  // In production, this would be a dedicated DSR table.
  const dsrEvents = await db.auditLog.findMany({
    where: {
      tenantId: session.tenantId,
      eventType: 'consent.recorded',
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const dsrs = dsrEvents
    .map((e) => {
      try {
        const payload = JSON.parse(e.payload)
        if (payload.dsr) {
          return {
            id: e.id,
            externalUserId: payload.externalUserId,
            requestType: payload.requestType,
            status: payload.status ?? 'pending',
            notes: payload.notes,
            resolution: payload.resolution,
            createdAt: e.createdAt,
            chainIndex: e.chainIndex,
          }
        }
      } catch {}
      return null
    })
    .filter(Boolean)

  return NextResponse.json({ success: true, dsrs })
}

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json()
  const validation = DsrCreateSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { externalUserId, requestType, notes } = validation.data

  // For erasure requests, execute immediately (or queue for manual review)
  if (requestType === 'erasure') {
    const result = await revokeTemplate(session.tenantId, externalUserId)
    await appendAudit({
      tenantId: session.tenantId,
      eventType: 'consent.recorded',
      payload: {
        dsr: true,
        externalUserId,
        requestType,
        status: 'resolved',
        notes,
        resolution: `Template deleted. Receipt: ${result.revocationReceipt.slice(0, 24)}...`,
      },
    })
    return NextResponse.json({
      success: true,
      status: 'resolved',
      message: 'Erasure executed — template deleted',
      receipt: result.revocationReceipt,
    })
  }

  // For access/portability/objection — create a pending DSR
  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'consent.recorded',
    payload: {
      dsr: true,
      externalUserId,
      requestType,
      status: 'pending',
      notes,
    },
  })

  logger.info({ tenantId: session.tenantId, externalUserId, requestType }, 'DSR created')

  return NextResponse.json({
    success: true,
    status: 'pending',
    message: `${requestType} request created`,
  })
}

export async function PUT(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can resolve DSRs' }, { status: 403 })
  }

  const body = await req.json()
  const validation = DsrResolveSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { dsrId, status, resolution } = validation.data

  // Update the DSR audit entry's payload
  const dsrEvent = await db.auditLog.findFirst({
    where: { id: dsrId, tenantId: session.tenantId },
  })

  if (!dsrEvent) {
    return NextResponse.json({ success: false, error: 'DSR not found' }, { status: 404 })
  }

  const payload = JSON.parse(dsrEvent.payload)
  payload.status = status
  if (resolution) payload.resolution = resolution

  await db.auditLog.update({
    where: { id: dsrId },
    data: { payload: JSON.stringify(payload) },
  })

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'consent.recorded',
    payload: { dsr: true, action: 'resolved', dsrId, status, resolution },
  })

  return NextResponse.json({ success: true, status })
}
