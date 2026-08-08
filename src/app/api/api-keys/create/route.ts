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
import { logger } from '@/lib/logger'
import { enqueueEmail, getTenantAdminRecipient } from '@/lib/email-notifications'

// SECURITY FIX (M-9): Validate expiresInDays to prevent:
//   - Negative values (would create an already-expired key)
//   - Zero (would create an immediately-expired key)
//   - Huge values (would create effectively-non-expiring keys, defeating
//     the purpose of key rotation)
//   - Non-integer values (would cause silent truncation)
const MAX_API_KEY_LIFETIME_DAYS = 365 // 1 year — forces key rotation
const MIN_API_KEY_LIFETIME_DAYS = 1

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { label, scopes, environment, expiresInDays } = body

    if (!label || typeof label !== 'string') {
      return NextResponse.json({ success: false, error: 'label required' }, { status: 400 })
    }
    if (label.length > 256) {
      return NextResponse.json({ success: false, error: 'label too long (max 256 chars)' }, { status: 400 })
    }
    if (environment && environment !== 'live' && environment !== 'test') {
      return NextResponse.json({ success: false, error: 'environment must be live|test' }, { status: 400 })
    }

    // SECURITY FIX (M-9): Validate expiresInDays
    let validatedExpiresInDays: number | undefined
    if (expiresInDays !== undefined && expiresInDays !== null) {
      if (typeof expiresInDays !== 'number' || !Number.isInteger(expiresInDays)) {
        return NextResponse.json(
          { success: false, error: 'expiresInDays must be an integer' },
          { status: 400 },
        )
      }
      if (expiresInDays < MIN_API_KEY_LIFETIME_DAYS) {
        return NextResponse.json(
          { success: false, error: `expiresInDays must be at least ${MIN_API_KEY_LIFETIME_DAYS}` },
          { status: 400 },
        )
      }
      if (expiresInDays > MAX_API_KEY_LIFETIME_DAYS) {
        return NextResponse.json(
          { success: false, error: `expiresInDays must not exceed ${MAX_API_KEY_LIFETIME_DAYS} days (use key rotation instead)` },
          { status: 400 },
        )
      }
      validatedExpiresInDays = expiresInDays
    }

    const apiKey = await createApiKey(authResult.auth.tenantId!, {
      label,
      scopes,
      environment,
      expiresInDays: validatedExpiresInDays,
    })

    // Fire API-key-created email to tenant admin (best-effort, non-blocking)
    void (async () => {
      try {
        const admin = await getTenantAdminRecipient(authResult.auth.tenantId!)
        if (admin) {
          await enqueueEmail({
            tenantId: authResult.auth.tenantId!,
            to: admin.email,
            userId: admin.userId,
            template: 'security.api_key_created',
            vars: {
              name: admin.name ?? undefined,
              label,
              timestamp: new Date().toISOString(),
              ip: authResult.ip,
            },
          })
        }
      } catch (e) {
        logger.warn({ error: e }, 'Failed to enqueue API-key-created email')
      }
    })()

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
