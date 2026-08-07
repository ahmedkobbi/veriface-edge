/**
 * POST /api/api-keys/create
 * Create a new API key for the authenticated tenant.
 *
 * Requires:
 *   Authorization: Bearer <existing API key with 'tenant:admin' scope>
 *
 * Body:
 *   { label: string, scopes?: string, environment?: 'live'|'test', expiresInDays?: number }
 *
 * Returns:
 *   { apiKey: { plaintext, ... } }  — plaintext shown ONCE
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey, createApiKey } from '@/lib/auth'
import { safeErrorResponse } from '@/lib/config'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { label, scopes, environment, expiresInDays } = body

    if (!label || typeof label !== 'string') {
      return NextResponse.json({ success: false, error: 'label required' }, { status: 400 })
    }
    if (environment && environment !== 'live' && environment !== 'test') {
      return NextResponse.json({ success: false, error: 'environment must be live|test' }, { status: 400 })
    }

    const apiKey = await createApiKey(authResult.auth.tenantId!, {
      label,
      scopes,
      environment,
      expiresInDays,
    })

    return NextResponse.json({
      success: true,
      apiKey,
      warning: 'Store the plaintext API key securely. It will NOT be returned again.',
    })
  } catch (e) {
    return NextResponse.json(
      safeErrorResponse(e),
      { status: 500 },
    )
  }
}
