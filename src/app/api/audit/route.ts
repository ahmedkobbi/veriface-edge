/**
 * GET /api/audit?limit=50&offset=0
 * Fetch the hash-chained audit log for the authenticated tenant.
 *
 * Requires 'audit:read' scope. Tenant ID is derived from the API key
 * (NOT from query params — prevents tenant spoofing).
 */

import { NextRequest, NextResponse } from 'next/server'
import { queryAuditLog } from '@/lib/audit'
import { requireApiKey } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const authResult = await requireApiKey(req, 'audit:read')
  if (!authResult.ok) return authResult.response

  const url = new URL(req.url)
  const tenantId = authResult.auth.tenantId!

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
      apiKeyId: e.apiKeyId,
      createdAt: e.createdAt,
    })),
  })
}
