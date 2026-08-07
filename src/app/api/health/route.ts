/**
 * GET /api/health
 * Health check endpoint for load balancers and monitoring.
 *
 * Returns:
 *   { status, uptime, version, db: 'ok'|'down', timestamp }
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const startedAt = Date.now()

export async function GET() {
  let dbStatus: 'ok' | 'down' = 'ok'
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    dbStatus = 'down'
  }

  return NextResponse.json({
    status: dbStatus === 'ok' ? 'healthy' : 'degraded',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version: '1.0.0',
    db: dbStatus,
    timestamp: new Date().toISOString(),
  }, { status: dbStatus === 'ok' ? 200 : 503 })
}
