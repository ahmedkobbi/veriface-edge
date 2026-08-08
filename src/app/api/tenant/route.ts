/**
 * POST /api/tenant
 * Create a new enterprise tenant + initial API key.
 *
 * SECURITY FIX (S-02): The Ed25519 signing private key is encrypted at rest
 * and stored server-side (signingPrivateKeyEncrypted). It is NEVER returned
 * to the client. The SDK uses the /api/session/sign endpoint to have the
 * server sign JWTs — the private key never leaves the server.
 *
 * Returns:
 *   - tenant metadata (public fields only)
 *   - initial API key plaintext (for backend integration — shown ONCE)
 *
 * Authentication:
 *   - Requires bootstrap secret in production (VERIFACE_BOOTSTRAP_SECRET env)
 *   - Open in development for demo purposes
 *
 * GET /api/tenant?id=xxx
 * Fetch tenant metadata. Requires API key with 'tenant:admin' scope.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createTenant, getTenant } from '@/lib/tenant'
import { createApiKey, requireApiKey } from '@/lib/auth'
import { constantTimeEqual } from '@/lib/crypto-server'
import { safeErrorResponse } from '@/lib/config'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  try {
    // In production, require bootstrap secret to prevent unauthorized tenant creation
    if (process.env.NODE_ENV === 'production') {
      const bootstrapSecret = req.headers.get('x-bootstrap-secret')
      const expectedSecret = process.env.VERIFACE_BOOTSTRAP_SECRET
      if (!expectedSecret) {
        logger.error('VERIFACE_BOOTSTRAP_SECRET not set in production — refusing to create tenant')
        return NextResponse.json(
          { success: false, error: 'Tenant creation is disabled (bootstrap secret not configured)' },
          { status: 503 },
        )
      }
      // SECURITY FIX (H-15): Use constant-time comparison instead of !==
      // to prevent timing attacks on the bootstrap secret.
      if (!constantTimeEqual(bootstrapSecret ?? '', expectedSecret)) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }
    }

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

    // SECURITY FIX (S-02): The signing private key is stored encrypted in the DB.
    // It is NEVER returned to the client. The SDK uses /api/session/sign to
    // have the server sign JWTs — the private key never leaves the server.
    return NextResponse.json({
      success: true,
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        signingPubKey: result.tenant.signingPubKey,
        kmsKeyId: result.tenant.kmsKeyId,
      },
      apiKey: apiKey.plaintext,
      apiKeyId: apiKey.id,
      warning: 'Store the API key securely. It will NOT be returned again. The signing private key is stored server-side and used via /api/session/sign.',
    })
  } catch (e) {
    return NextResponse.json(safeErrorResponse(e), { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  // Require API key authentication for tenant metadata
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ success: false, error: 'id parameter required' }, { status: 400 })
  }

  // SECURITY FIX (C-4): Enforce tenant scope — API key can only access
  // its own tenant's metadata. Prevents cross-tenant data leakage (IDOR).
  if (id !== authResult.auth.tenantId) {
    return NextResponse.json(
      { success: false, error: 'Forbidden: cannot access other tenants', code: 'TENANT_SCOPE_VIOLATION' },
      { status: 403 },
    )
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
