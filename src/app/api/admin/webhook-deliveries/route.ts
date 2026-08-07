/**
 * GET /api/admin/webhook-deliveries
 * Returns webhook delivery history with retry details, HTTP codes, latency.
 *
 * Query params: ?limit=50&state=pending|delivered|failed|dead_letter
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200)
  const state = url.searchParams.get('state')

  const deliveries = await db.webhookDelivery.findMany({
    where: {
      tenantId: session.tenantId,
      ...(state ? { state } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      eventType: true,
      state: true,
      attempts: true,
      lastResponseCode: true,
      lastError: true,
      nextRetryAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  // Summary stats
  const stats = {
    total: deliveries.length,
    delivered: deliveries.filter(d => d.state === 'delivered').length,
    pending: deliveries.filter(d => d.state === 'pending').length,
    failed: deliveries.filter(d => d.state === 'failed').length,
    deadLettered: deliveries.filter(d => d.state === 'dead_letter').length,
  }

  return NextResponse.json({
    success: true,
    deliveries: deliveries.map(d => ({
      id: d.id,
      eventType: d.eventType,
      state: d.state,
      attempts: d.attempts,
      lastResponseCode: d.lastResponseCode,
      lastError: d.lastError,
      nextRetryAt: d.nextRetryAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      age: Math.floor((Date.now() - d.createdAt.getTime()) / 1000),
    })),
    stats,
  })
}
