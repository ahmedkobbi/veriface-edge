/**
 * GET /api/admin/settings — Retrieve tenant configuration
 * PUT /api/admin/settings — Update tenant configuration
 *
 * Configurable fields:
 *   - livenessThreshold (0.0–1.0, default 0.78)
 *   - rateLimitPerMin (1–1000, default 60)
 *   - maxSessionAgeSec (10–3600, default 60)
 *   - webhookUrl (HTTPS URL or null)
 *
 * All fields validated server-side. Changes are audit-logged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import { safeErrorResponse } from '@/lib/config'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const SettingsUpdateSchema = z.object({
  // SECURITY FIX (H-8): Enforce minimum liveness threshold of 0.5
  // Previously allowed 0.1 — defeated anti-spoofing (printed photos pass)
  livenessThreshold: z.number().min(0.5).max(1.0).optional(),
  rateLimitPerMin: z.number().int().min(1).max(1000).optional(),
  maxSessionAgeSec: z.number().int().min(10).max(3600).optional(),
  webhookUrl: z.string().url().regex(/^https:\/\//).nullable().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId },
    select: {
      id: true,
      name: true,
      livenessThreshold: true,
      rateLimitPerMin: true,
      maxSessionAgeSec: true,
      webhookUrl: true,
      signingPubKey: true,
      kmsKeyId: true,
      active: true,
      createdAt: true,
    },
  })

  if (!tenant) {
    return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, settings: tenant })
}

export async function PUT(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // Only admins can change settings
  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can modify settings' }, { status: 403 })
  }

  const body = await req.json()
  const validation = SettingsUpdateSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const updates = validation.data
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 })
  }

  const updated = await db.tenant.update({
    where: { id: session.tenantId },
    data: updates,
    select: {
      livenessThreshold: true,
      rateLimitPerMin: true,
      maxSessionAgeSec: true,
      webhookUrl: true,
    },
  })

  await appendAudit({
    tenantId: session.tenantId,
    // SECURITY FIX (L-4): Was 'key.rotated' — this is a tenant config update.
    eventType: 'tenant.config_updated',
    payload: { action: 'settings_updated', fields: Object.keys(updates) },
  })

  logger.info({ tenantId: session.tenantId, updates: Object.keys(updates) }, 'Tenant settings updated')

  return NextResponse.json({ success: true, settings: updated })
}
