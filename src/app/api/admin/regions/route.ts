/**
 * GET /api/admin/regions — List all regions + status
 * POST /api/admin/regions — Failover to a new primary region
 *
 * Body (POST): { action: "failover", regionId: "eu-west-1" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { getRegions, failoverRegion } from '@/lib/replication'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  return NextResponse.json({
    success: true,
    regions: getRegions().map(r => ({
      ...r,
      lastHeartbeat: r.lastHeartbeat.toISOString(),
    })),
    primaryRegion: getRegions().find(r => r.isPrimary)?.id,
  })
}

const FailoverSchema = z.object({
  action: z.literal('failover'),
  regionId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can manage regions' }, { status: 403 })
  }

  const body = await req.json()
  const validation = FailoverSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const result = await failoverRegion(validation.data.regionId)

  await appendAudit({
    tenantId: session.tenantId,
    // SECURITY FIX (L-4): Was 'key.rotated' — this is a region failover event.
    eventType: 'user.region_updated',
    payload: {
      action: 'region_failover',
      targetRegion: validation.data.regionId,
      success: result.success,
    },
  })

  logger.warn({ tenantId: session.tenantId, targetRegion: validation.data.regionId }, 'Region failover requested')

  return NextResponse.json({ success: result.success, message: result.message })
}

// Need to import getRegions for the primary lookup
import { getRegions as getRegionsList } from '@/lib/replication'
