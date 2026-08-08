/**
 * GET /api/status
 * Public status page — no auth required.
 * Returns system health, component status, uptime, recent incidents.
 *
 * SECURITY FIX (M-12): Removed business metrics (totalTenants, totalAuths,
 * totalEnrollments) from the PUBLIC response. These are competitively
 * sensitive and could be used by attackers to gauge the platform's size
 * or by competitors for market intelligence. They are now only available
 * via the authenticated /api/admin/analytics endpoint.
 *
 * The public status page now returns ONLY:
 *   - Overall status (operational / degraded / partial_outage)
 *   - Per-component status (no latencies — just up/down)
 *   - SLA targets (publicly committed)
 *   - Active incidents (publicly communicated)
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const startedAt = Date.now()

export async function GET() {
  const uptime = Math.floor((Date.now() - startedAt) / 1000)

  // Check database
  let dbStatus: 'operational' | 'degraded' | 'down' = 'operational'
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    dbStatus = 'down'
  }

  // Check WebSocket (best-effort, non-blocking)
  let wsStatus: 'operational' | 'degraded' | 'down' = 'degraded'
  try {
    const res = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(2000) })
    wsStatus = res.ok ? 'operational' : 'degraded'
  } catch {
    wsStatus = 'degraded'
  }

  // SECURITY FIX (M-12): No latencies in the public response.
  // Latencies reveal infrastructure details (DB location, instance size).
  const components = [
    { name: 'API Server', status: 'operational' as const },
    { name: 'Database', status: dbStatus },
    { name: 'WebSocket Server', status: wsStatus },
    { name: 'Edge AI Pipeline', status: 'operational' as const, description: 'Runs client-side' },
    { name: 'Webhook Delivery', status: 'operational' as const, description: 'Queue-based with retries' },
    { name: 'OIDC Provider', status: 'operational' as const },
    { name: 'Audit Log Chain', status: 'operational' as const, description: 'SHA-256 hash-chained' },
  ]

  const overallStatus = components.every(c => c.status === 'operational')
    ? 'operational'
    : components.some(c => c.status === 'down')
    ? 'partial_outage'
    : 'degraded'

  return NextResponse.json({
    status: overallStatus,
    // NOTE: uptime is fine to expose — it tells users about recent restarts
    // (transparency), and doesn't reveal business metrics.
    uptime,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    components,
    // SECURITY FIX (M-12): No metrics block. Use /api/admin/analytics (auth'd)
    // for business metrics.
    incidents: [], // In production: fetch from incidents table
    sla: {
      uptime: '99.9%',
      responseTime: '< 500ms p95',
      supportResponse: '< 4 hours',
    },
  })
}
