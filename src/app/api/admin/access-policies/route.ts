/**
 * GET /api/admin/access-policies — Retrieve access policies
 * PUT /api/admin/access-policies — Update access policies
 *
 * Policies:
 *   - geoAllowlist: string[] (country codes, e.g. ['US','GB','DE'])
 *   - geoDenylist: string[] (country codes to block)
 *   - timeWindowStart: string (HH:MM, e.g. '09:00')
 *   - timeWindowEnd: string (HH:MM, e.g. '17:00')
 *   - timeWindowEnabled: boolean
 *   - maxAuthsPerUserPerDay: number (0 = unlimited)
 *   - requireHardwareAttestation: boolean
 *   - blockVpn: boolean (block known VPN/proxy IPs)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import { z } from 'zod'

// In-memory policy store (production: DB column on Tenant or separate table)
interface AccessPolicy {
  geoAllowlist: string[]
  geoDenylist: string[]
  timeWindowStart: string
  timeWindowEnd: string
  timeWindowEnabled: boolean
  maxAuthsPerUserPerDay: number
  requireHardwareAttestation: boolean
  blockVpn: boolean
}

const defaultPolicy: AccessPolicy = {
  geoAllowlist: [],
  geoDenylist: [],
  timeWindowStart: '00:00',
  timeWindowEnd: '23:59',
  timeWindowEnabled: false,
  maxAuthsPerUserPerDay: 0,
  requireHardwareAttestation: false,
  blockVpn: false,
}

const policyStore = new Map<string, AccessPolicy>()

const PolicyUpdateSchema = z.object({
  geoAllowlist: z.array(z.string().length(2)).optional(),
  geoDenylist: z.array(z.string().length(2)).optional(),
  timeWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timeWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timeWindowEnabled: z.boolean().optional(),
  maxAuthsPerUserPerDay: z.number().int().min(0).max(10000).optional(),
  requireHardwareAttestation: z.boolean().optional(),
  blockVpn: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const policy = policyStore.get(session.tenantId) ?? defaultPolicy

  return NextResponse.json({
    success: true,
    policy,
    availableCountries: [
      { code: 'US', name: 'United States' },
      { code: 'GB', name: 'United Kingdom' },
      { code: 'DE', name: 'Germany' },
      { code: 'FR', name: 'France' },
      { code: 'JP', name: 'Japan' },
      { code: 'SG', name: 'Singapore' },
      { code: 'AU', name: 'Australia' },
      { code: 'CA', name: 'Canada' },
      { code: 'NL', name: 'Netherlands' },
      { code: 'BR', name: 'Brazil' },
      { code: 'IN', name: 'India' },
      { code: 'AE', name: 'UAE' },
    ],
  })
}

export async function PUT(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can modify access policies' }, { status: 403 })
  }

  const body = await req.json()
  const validation = PolicyUpdateSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const current = policyStore.get(session.tenantId) ?? defaultPolicy
  const updated = { ...current, ...validation.data }
  policyStore.set(session.tenantId, updated)

  await appendAudit({
    tenantId: session.tenantId,
    // SECURITY FIX (L-4): Was 'key.rotated' — this is an access policy update.
    eventType: 'user.access_policy_updated',
    payload: { action: 'access_policy_updated', fields: Object.keys(validation.data) },
  })

  return NextResponse.json({ success: true, policy: updated })
}

// Export for use in session/verify middleware
export function getAccessPolicy(tenantId: string): AccessPolicy {
  return policyStore.get(tenantId) ?? defaultPolicy
}

export function checkAccessPolicy(policy: AccessPolicy, ip: string, hour: number): { allowed: boolean; reason?: string } {
  // Time window check
  if (policy.timeWindowEnabled) {
    const [startH, startM] = policy.timeWindowStart.split(':').map(Number)
    const [endH, endM] = policy.timeWindowEnd.split(':').map(Number)
    const startMin = startH * 60 + startM
    const endMin = endH * 60 + endM
    const currentMin = hour * 60
    if (startMin < endMin) {
      if (currentMin < startMin || currentMin > endMin) {
        return { allowed: false, reason: 'OUTSIDE_TIME_WINDOW' }
      }
    } else {
      // Overnight window (e.g. 22:00 to 06:00)
      if (currentMin > endMin && currentMin < startMin) {
        return { allowed: false, reason: 'OUTSIDE_TIME_WINDOW' }
      }
    }
  }

  // In production: geo-lookup IP against MaxMind DB
  // For now: pass through (geo-allow/deny would be enforced with a GeoIP DB)
  return { allowed: true }
}
