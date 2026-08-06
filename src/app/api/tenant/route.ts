/**
 * POST /api/tenant
 * Create a new enterprise tenant. Returns tenant ID + signing private key.
 *
 * The signing private key is returned ONCE — it must be embedded in the
 * client SDK configuration. Store it in your secrets manager (Vault, KMS, etc.)
 *
 * GET /api/tenant?id=xxx
 * Fetch tenant metadata (public fields only — signing key never returned).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createTenant, getTenant } from '@/lib/tenant'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name } = body
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ success: false, error: 'name required' }, { status: 400 })
    }

    const result = await createTenant(name)
    return NextResponse.json({
      success: true,
      tenant: result.tenant,
      signingPrivateKey: result.signingPrivateKey,
      warning: 'Store signingPrivateKey in your secrets manager. It will NOT be returned again.',
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ success: false, error: 'id parameter required' }, { status: 400 })
  }
  const tenant = await getTenant(id)
  if (!tenant) {
    return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 })
  }
  return NextResponse.json({
    success: true,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      signingPubKey: tenant.signingPubKey,
      kmsKeyId: tenant.kmsKeyId,
      livenessThreshold: tenant.livenessThreshold,
      maxSessionAgeSec: tenant.maxSessionAgeSec,
      webhookUrl: tenant.webhookUrl,
      active: tenant.active,
      createdAt: tenant.createdAt,
    },
  })
}
