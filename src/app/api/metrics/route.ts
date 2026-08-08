/**
 * GET /api/metrics
 * Prometheus metrics endpoint for monitoring.
 *
 * SECURITY FIX (M-13): Previously, the metrics endpoint was unauthenticated
 * in development mode — exposing internal metrics (request counts, error
 * rates, cache sizes, latencies) to anyone who could reach the dev server.
 * In dev, the server is often exposed on 0.0.0.0 or via a tunnel (ngrok),
 * making this a real leak.
 *
 * Now: the endpoint is ALWAYS authenticated. Two paths:
 *   1. API key with 'audit:read' scope (production monitoring stack)
 *   2. Loopback IP (127.0.0.1, ::1) — for local Prometheus scraping
 *      without needing to inject an API key into the scrape config.
 *
 * Non-loopback requests without an API key are rejected with 401 in ALL
 * environments.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMetrics, getMetricsContentType } from '@/lib/metrics'
import { requireApiKey } from '@/lib/auth'

// Loopback IPs that are allowed to scrape without an API key.
// These are the only IPs a local Prometheus instance would use.
const LOOPBACK_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1', // IPv4-mapped IPv6
])

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    return xff.split(',')[0].trim()
  }
  // In Next.js, req.headers.get('x-real-ip') is set by some proxies
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export async function GET(req: NextRequest) {
  // SECURITY FIX (M-13): Always require auth.
  // Allow loopback (local Prometheus) without an API key.
  const clientIp = getClientIp(req)
  const isLoopback = LOOPBACK_IPS.has(clientIp)

  if (!isLoopback) {
    // Non-loopback request — require API key with 'audit:read' scope
    const authResult = await requireApiKey(req, 'audit:read')
    if (!authResult.ok) return authResult.response
  }

  const metrics = await getMetrics()
  return new NextResponse(metrics, {
    headers: { 'Content-Type': getMetricsContentType() },
  })
}
