/**
 * POST /api/tenant
 * Create a new enterprise tenant + initial API key.
 *
 * Returns:
 *   - tenant metadata
 *   - signing private key (for client SDK)
 *   - initial API key plaintext (for backend integration)
 *
 * Both secrets are shown ONCE — caller must persist them.
 *
 * GET /api/tenant?id=xxx
 * Fetch tenant metadata (requires API key with 'tenant:admin' scope,
 * OR can be called without auth if the id is provided in the URL — for
 * bootstrap scenarios where the caller doesn't yet have an API key).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createTenant, getTenant } from '@/lib/tenant'
import { createApiKey } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name } = body
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ success: false, error: 'name required' }, { status: 400 })
    }

    const result = await createTenant(name)
    const apiKey = await createApiKey(result.tenant.id, {
      label: 'Initial API Key',
      scopes: '*',
      environment: 'live',
    })

    return NextResponse.json({
      success: true,
      tenant: result.tenant,
      signingPrivateKey: result.signingPrivateKey,
      apiKey: apiKey.plaintext,
      apiKeyId: apiKey.id,
      warning: 'Store signingPrivateKey and apiKey in your secrets manager. They will NOT be returned again.',
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
      rateLimitPerMin: tenant.rateLimitPerMin,
      active: tenant.active,
      createdAt: tenant.createdAt,
    },
  })
}
