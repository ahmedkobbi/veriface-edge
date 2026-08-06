/**
 * GET /api/audit?tenantId=xxx&limit=50&offset=0
 * Fetch the hash-chained audit log for a tenant.
 *
 * POST /api/audit/verify?tenantId=xxx
 * Walk the audit chain and verify integrity (detect tampering).
 */

import { NextRequest, NextResponse } from 'next/server'
import { queryAuditLog, verifyAuditChain } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ success: false, error: 'tenantId required' }, { status: 400 })
  }

  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
  const eventType = url.searchParams.get('eventType') as any
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const entries = await queryAuditLog(tenantId, {
    limit,
    offset,
    eventType,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  })

  return NextResponse.json({
    success: true,
    entries: entries.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      payload: JSON.parse(e.payload),
      chainIndex: e.chainIndex,
      prevHash: e.prevHash,
      thisHash: e.thisHash,
      actorIp: e.actorIp,
      createdAt: e.createdAt,
    })),
  })
}
