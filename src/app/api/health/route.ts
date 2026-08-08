/**
 * GET /api/health
 *
 * Comprehensive health check for load balancers and monitoring.
 *
 * SECURITY FIX (M-14): Previously, the health endpoint exposed internal
 * details in the PUBLIC response:
 *   - PID (process ID — useful for process-injection attacks)
 *   - Exact heap usage (memory layout info — useful for heap-spray attacks)
 *   - Exact latencies per component (infrastructure fingerprinting)
 *   - Detailed error messages (info leak for attackers probing the system)
 *
 * Now: the PUBLIC response contains ONLY:
 *   - Overall status (healthy / degraded / down)
 *   - Per-component status (ok / degraded / down — no latencies, no details)
 *   - Version + timestamp
 *
 * Detailed info (latencies, heap, PID, error details) is logged server-side
 * at the debug level — accessible to operators via structured logs, not to
 * anonymous HTTP clients.
 *
 * Returns:
 *   200 — all checks pass (status: "healthy")
 *   503 — one or more checks fail (status: "degraded")
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

const startedAt = Date.now()

interface HealthCheck {
  name: string
  status: 'ok' | 'degraded' | 'down'
  latencyMs?: number
  detail?: string
}

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return { name: 'database', status: 'ok', latencyMs: Date.now() - start }
  } catch (e) {
    return {
      name: 'database',
      status: 'down',
      latencyMs: Date.now() - start,
      detail: 'Check failed',
    }
  }
}

function checkMemory(): HealthCheck {
  const mem = process.memoryUsage()
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024)
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024)
  const rssMB = Math.round(mem.rss / 1024 / 1024)
  const heapPercent = (heapUsedMB / heapTotalMB) * 100

  // Degraded if heap usage > 80%
  if (heapPercent > 80) {
    return {
      name: 'memory',
      status: 'degraded',
      detail: `Heap at ${heapPercent.toFixed(1)}% (${heapUsedMB}/${heapTotalMB}MB)`,
    }
  }
  return {
    name: 'memory',
    status: 'ok',
    detail: `Heap: ${heapUsedMB}/${heapTotalMB}MB, RSS: ${rssMB}MB`,
  }
}

async function checkWebSocket(): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const res = await fetch('http://localhost:3001/health', {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) {
      return { name: 'websocket', status: 'ok', latencyMs: Date.now() - start }
    }
    return { name: 'websocket', status: 'down', detail: `HTTP ${res.status}` }
  } catch {
    // WebSocket server is optional (mini-service may not be running)
    return { name: 'websocket', status: 'degraded', detail: 'Not reachable' }
  }
}

function checkUptime(): HealthCheck {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000)
  return {
    name: 'process',
    status: 'ok',
    detail: `Uptime: ${uptimeSec}s, PID: ${process.pid}`,
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkDatabase(),
    checkMemory(),
    checkWebSocket(),
    checkUptime(),
  ])

  const allOk = checks.every((c) => c.status === 'ok')
  const anyDown = checks.some((c) => c.status === 'down')
  const status = anyDown ? 'degraded' : allOk ? 'healthy' : 'degraded'

  // SECURITY FIX (M-14): Log the detailed checks server-side for operators.
  // Do NOT include details/latencies/PID in the public response.
  logger.debug({ checks, status }, 'Health check details')

  // PUBLIC response — minimal, no internal details
  const response = {
    status,
    // Bucket uptime into coarse ranges to avoid leaking exact restart times
    // (which could reveal deployment cadence).
    uptimeBucket:
      Date.now() - startedAt < 60_000 ? '< 1min' :
      Date.now() - startedAt < 3_600_000 ? '< 1hr' :
      Date.now() - startedAt < 86_400_000 ? '< 24hr' :
      '> 24hr',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    // Per-component status only — no latencies, no details
    components: checks.reduce((acc, c) => {
      acc[c.name] = { status: c.status }
      return acc
    }, {} as Record<string, { status: string }>),
  }

  return NextResponse.json(response, {
    status: status === 'healthy' ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Health-Status': status,
    },
  })
}
