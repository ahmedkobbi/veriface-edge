/**
 * GET /api/admin/notifications/history
 * Paginated email log for the admin panel.
 *
 * Query params:
 *   ?state=pending|sent|failed|suppressed  (filter by state)
 *   ?template=auth.new_device               (filter by template)
 *   ?cursor=<base64>                        (cursor pagination)
 *   ?limit=50                               (max 200)
 *
 * Returns: { entries, nextCursor, hasMore, summary }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? undefined
  const template = url.searchParams.get('template') ?? undefined
  const cursor = url.searchParams.get('cursor') ?? undefined
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200)

  // Decode cursor
  let cursorId: string | undefined
  if (cursor) {
    try {
      cursorId = Buffer.from(cursor, 'base64').toString('utf-8')
    } catch {}
  }

  const entries = await db.emailLog.findMany({
    where: {
      tenantId: session.tenantId,
      ...(state ? { state } : {}),
      ...(template ? { template } : {}),
      ...(cursorId ? { id: { lt: cursorId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      toAddress: true,
      template: true,
      subject: true,
      state: true,
      attempts: true,
      maxAttempts: true,
      lastResponseCode: true,
      lastError: true,
      nextRetryAt: true,
      sentAt: true,
      createdAt: true,
      dedupKey: true,
    },
  })

  const hasMore = entries.length > limit
  const results = hasMore ? entries.slice(0, limit) : entries
  const nextCursor = hasMore && results.length > 0 ? Buffer.from(results[results.length - 1].id).toString('base64') : null

  // Summary counts
  const summary = await db.emailLog.groupBy({
    by: ['state'],
    where: { tenantId: session.tenantId },
    _count: { state: true },
  })

  const summaryMap: Record<string, number> = {}
  for (const row of summary) summaryMap[row.state] = row._count.state

  return NextResponse.json({
    success: true,
    entries: results,
    nextCursor,
    hasMore,
    summary: {
      pending: summaryMap.pending ?? 0,
      sent: summaryMap.sent ?? 0,
      failed: summaryMap.failed ?? 0,
      suppressed: summaryMap.suppressed ?? 0,
      total: Object.values(summaryMap).reduce((a, b) => a + b, 0),
    },
  })
}
