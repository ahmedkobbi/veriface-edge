/**
 * GET /api/audit?limit=50&cursor=<base64>&eventType=xxx&from=ISO&to=ISO
 *
 * Cursor-based pagination for the hash-chained audit log.
 * Returns: { entries, nextCursor, hasMore }
 */

import { NextRequest, NextResponse } from 'next/server'
import { queryAuditLog } from '@/lib/audit'
import { requireApiKey } from '@/lib/auth'
import { jsonResponseWithETag } from '@/lib/etag'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const authResult = await requireApiKey(req, 'audit:read')
  if (!authResult.ok) return authResult.response

  const url = new URL(req.url)
  const tenantId = authResult.auth.tenantId!

  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
  const cursor = url.searchParams.get('cursor') ?? undefined
  const eventType = url.searchParams.get('eventType') as any
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const result = await queryAuditLog(tenantId, {
    limit,
    cursor,
    eventType,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  })

  const responseBody = {
    success: true,
    entries: result.entries.map((e) => ({
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
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  }

  logger.info({ tenantId, count: result.entries.length, hasMore: result.hasMore }, 'Audit log queried')

  return jsonResponseWithETag(responseBody, 200, authResult.rateLimitHeaders)
}
