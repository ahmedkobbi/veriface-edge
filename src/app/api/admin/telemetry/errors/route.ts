/**
 * GET /api/admin/telemetry/errors
 * Cursor-paginated list of recent SDK error events.
 *
 * Query params:
 *   ?errorCode=LIVENESS_FAILED  (filter by error code)
 *   ?severity=error             (filter by severity)
 *   ?stage=capture              (filter by stage)
 *   ?cursor=<base64>            (cursor pagination)
 *   ?limit=50                   (max 200)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { sha256Hex } from '@/lib/crypto-server'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const tenantIdHash = sha256Hex(session.tenantId)
  const url = new URL(req.url)
  const errorCode = url.searchParams.get('errorCode') ?? undefined
  const severity = url.searchParams.get('severity') ?? undefined
  const stage = url.searchParams.get('stage') ?? undefined
  const cursor = url.searchParams.get('cursor') ?? undefined
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200)

  let cursorId: string | undefined
  if (cursor) {
    try { cursorId = Buffer.from(cursor, 'base64').toString('utf-8') } catch {}
  }

  const entries = await db.sdkErrorEvent.findMany({
    where: {
      tenantIdHash,
      ...(errorCode ? { errorCode } : {}),
      ...(severity ? { severity } : {}),
      ...(stage ? { stage } : {}),
      ...(cursorId ? { id: { lt: cursorId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    select: {
      id: true,
      sdkVersion: true,
      errorCode: true,
      severity: true,
      stage: true,
      errorMessage: true,
      browserFamily: true,
      osFamily: true,
      hasWebGPU: true,
      hasCamera: true,
      sessionId: true,
      experimentId: true,
      experimentVariant: true,
      metrics: true,
      createdAt: true,
    },
  })

  const hasMore = entries.length > limit
  const results = hasMore ? entries.slice(0, limit) : entries
  const nextCursor = hasMore && results.length > 0
    ? Buffer.from(results[results.length - 1].id).toString('base64')
    : null

  return NextResponse.json({
    success: true,
    entries: results.map((e) => ({
      ...e,
      metrics: e.metrics ? JSON.parse(e.metrics) : null,
    })),
    nextCursor,
    hasMore,
  })
}
