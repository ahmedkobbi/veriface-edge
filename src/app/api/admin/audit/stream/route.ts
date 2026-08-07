/**
 * GET /api/admin/audit/stream
 *
 * Server-Sent Events (SSE) endpoint for real-time audit log streaming.
 * SIEM tools (Splunk, Datadog, Elastic SIEM, IBM QRadar) can connect
 * to this endpoint and receive audit entries in real-time.
 *
 * Query params:
 *   ?format=json|cef|leef|syslog  (default: json)
 *   ?eventType=auth.success,auth.failure  (comma-separated filter)
 *
 * Headers required: Cookie (session cookie for auth)
 *
 * Response: text/event-stream (SSE)
 *   Each event: data: {json}\n\n
 *
 * Heartbeat: every 30 seconds sends a comment to keep connection alive.
 */

import { NextRequest } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { subscribe, getSubscriberCount, toCEF, toLEEF, toSyslog } from '@/lib/audit-stream'
import { logger } from '@/lib/logger'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const url = new URL(req.url)
  const format = url.searchParams.get('format') ?? 'json'
  const eventTypeFilter = url.searchParams.get('eventType')
  const filters = eventTypeFilter
    ? { eventTypes: eventTypeFilter.split(',').map(s => s.trim()) }
    : undefined

  const subscriberId = crypto.randomUUID()

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // Send initial connection event
      const initEvent = `event: connected\ndata: ${JSON.stringify({
        subscriberId,
        tenantId: session.tenantId,
        format,
        filters: filters?.eventTypes ?? 'all',
        activeSubscribers: getSubscriberCount(session.tenantId),
      })}\n\n`
      controller.enqueue(encoder.encode(initEvent))

      // Register subscriber
      const unsubscribe = subscribe({
        id: subscriberId,
        tenantId: session.tenantId,
        controller,
        filters,
      })

      // Heartbeat every 30s (keep connection alive)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30_000)

      // Clean up on abort
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        unsubscribe()
        try { controller.close() } catch {}
        logger.info({ subscriberId }, 'SSE client disconnected')
      })

      logger.info({ subscriberId, tenantId: session.tenantId, format }, 'SSE audit stream connected')
    },
    cancel() {
      logger.info({ subscriberId }, 'SSE audit stream cancelled')
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
      'X-Subscriber-Id': subscriberId,
    },
  })
}
