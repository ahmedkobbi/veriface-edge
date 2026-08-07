/**
 * GET /api/admin/replication/status
 * Returns cross-region replication status:
 *   - Queue size, pending/synced/failed counts
 *   - Average replication lag
 *   - Per-region status + lag
 *   - Last sync timestamp
 *
 * POST /api/admin/replication/process
 * Manually trigger replication processing (admin only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { getReplicationStatus, processReplicationQueue } from '@/lib/replication'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const status = getReplicationStatus()

  return NextResponse.json({
    success: true,
    ...status,
    lastSyncAt: status.lastSyncAt?.toISOString() ?? null,
  })
}

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can trigger replication' }, { status: 403 })
  }

  const result = await processReplicationQueue(100)

  logger.info({ ...result, tenantId: session.tenantId }, 'Replication queue processed')

  return NextResponse.json({
    success: true,
    ...result,
  })
}
