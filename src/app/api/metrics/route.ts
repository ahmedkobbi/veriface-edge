/**
 * GET /api/metrics
 * Prometheus metrics endpoint for monitoring.
 * Protected by API key with 'audit:read' scope (or IP allowlist in prod).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMetrics, getMetricsContentType } from '@/lib/metrics'
import { requireApiKey } from '@/lib/auth'

export async function GET(req: NextRequest) {
  // In production, restrict to internal monitoring IPs or API key
  if (process.env.NODE_ENV === 'production') {
    const authResult = await requireApiKey(req, 'audit:read')
    if (!authResult.ok) return authResult.response
  }

  const metrics = await getMetrics()
  return new NextResponse(metrics, {
    headers: { 'Content-Type': getMetricsContentType() },
  })
}
