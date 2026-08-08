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

  // SECURITY FIX (M-8): Check the per-tenant SSE connection limit BEFORE
  // creating the stream. If the tenant has too many active subscribers,
  // reject the connection with 429 instead of accepting then failing.
  const currentSubscribers = getSubscriberCount(session.tenantId)
  const MAX_SUBSCRIBERS_PER_TENANT = 10
  if (currentSubscribers >= MAX_SUBSCRIBERS_PER_TENANT) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many concurrent SSE connections for this tenant',
        code: 'SSE_LIMIT_REACHED',
        limit: MAX_SUBSCRIBERS_PER_TENANT,
        active: currentSubscribers,
      },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

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

      // Register subscriber (M-8: subscribe may reject if limit hit between
      // the pre-check above and this call — race condition tolerant)
      const unsubscribe = subscribe({
        id: subscriberId,
        tenantId: session.tenantId,
        controller,
        filters,
      })

      if (!unsubscribe) {
        // Lost the race — another connection was accepted between the pre-check
        // and the subscribe call. Close this connection gracefully.
        const rejectEvent = `event: error\ndata: ${JSON.stringify({
          code: 'SSE_LIMIT_REACHED',
          message: 'Too many concurrent SSE connections',
        })}\n\n`
        controller.enqueue(encoder.encode(rejectEvent))
        controller.close()
        return
      }

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
