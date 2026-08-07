/**
 * GET /api/admin/branding — Get tenant branding config
 * PUT /api/admin/branding — Update branding (colors, logo URL, company name)
 *
 * Branding is used by the SDK to customize the UI for each tenant.
 * Stored in-memory (production: DB column on Tenant as JSON).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import { z } from 'zod'

interface BrandingConfig {
  companyName: string
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  customCss: string | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
}

const defaultBranding: BrandingConfig = {
  companyName: 'VeriFace Edge',
  primaryColor: '#10b981',
  accentColor: '#06b6d4',
  logoUrl: null,
  customCss: null,
  privacyPolicyUrl: null,
  termsUrl: null,
}

const brandingStore = new Map<string, BrandingConfig>()

const BrandingSchema = z.object({
  companyName: z.string().max(256).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logoUrl: z.string().url().nullable().optional(),
  customCss: z.string().max(10000).nullable().optional(),
  privacyPolicyUrl: z.string().url().nullable().optional(),
  termsUrl: z.string().url().nullable().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const branding = brandingStore.get(session.tenantId) ?? defaultBranding

  return NextResponse.json({ success: true, branding })
}

export async function PUT(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can modify branding' }, { status: 403 })
  }

  const body = await req.json()
  const validation = BrandingSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const current = brandingStore.get(session.tenantId) ?? defaultBranding
  const updated = { ...current, ...validation.data }
  brandingStore.set(session.tenantId, updated)

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: { action: 'branding_updated', fields: Object.keys(validation.data) },
  })

  return NextResponse.json({ success: true, branding: updated })
}

export function getBranding(tenantId: string): BrandingConfig {
  return brandingStore.get(tenantId) ?? defaultBranding
}
