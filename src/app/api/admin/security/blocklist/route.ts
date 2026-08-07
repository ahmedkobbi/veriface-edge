/**
 * GET /api/admin/security/blocklist — List blocked IPs
 * POST /api/admin/security/blocklist — Block an IP
 * DELETE /api/admin/security/blocklist — Unblock an IP (via body { ip })
 *
 * Blocked IPs are stored in-memory (production: Redis with TTL).
 * Requests from blocked IPs are rejected at the rate-limit layer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// In-memory blocklist (production: Redis SET with TTL)
// Key: tenantId, Value: Set of IPs
const blocklist = new Map<string, Set<string>>()

export function isIpBlocked(tenantId: string, ip: string): boolean {
  const set = blocklist.get(tenantId)
  return set ? set.has(ip) : false
}

const BlockIpSchema = z.object({
  ip: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Must be a valid IPv4 address'),
  reason: z.string().max(256).optional(),
})

const UnblockIpSchema = z.object({
  ip: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const set = blocklist.get(session.tenantId)
  const ips = set ? Array.from(set) : []

  return NextResponse.json({ success: true, ips })
}

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can block IPs' }, { status: 403 })
  }

  const body = await req.json()
  const validation = BlockIpSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { ip, reason } = validation.data

  if (!blocklist.has(session.tenantId)) {
    blocklist.set(session.tenantId, new Set())
  }
  blocklist.get(session.tenantId)!.add(ip)

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'injection.suspected',
    payload: { action: 'ip_blocked', ip, reason: reason ?? 'manual' },
  })

  logger.warn({ tenantId: session.tenantId, ip, reason }, 'IP blocked by admin')

  return NextResponse.json({ success: true, blocked: ip })
}

export async function DELETE(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can unblock IPs' }, { status: 403 })
  }

  const body = await req.json()
  const validation = UnblockIpSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { ip } = validation.data
  const set = blocklist.get(session.tenantId)
  if (set) {
    set.delete(ip)
  }

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'injection.suspected',
    payload: { action: 'ip_unblocked', ip },
  })

  return NextResponse.json({ success: true, unblocked: ip })
}
