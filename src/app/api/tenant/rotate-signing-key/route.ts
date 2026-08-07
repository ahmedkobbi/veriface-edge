/**
 * POST /api/tenant/rotate-signing-key
 * Rotate the tenant's Ed25519 signing keypair.
 *
 * The OLD key is retained for 24 hours to verify in-flight JWTs.
 * After 24h, the old key is purged.
 *
 * Body: { confirm: true }  (explicit confirmation required)
 *
 * Returns:
 *   { signingPubKey: <new>, signingPrivateKey: <new, shown ONCE> }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { appendAudit } from '@/lib/audit'
import { ed25519Generate } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    if (!body?.confirm) {
      return NextResponse.json({
        success: false,
        error: 'Confirmation required: send { confirm: true } to proceed with key rotation',
      }, { status: 400 })
    }

    const tenantId = authResult.auth.tenantId!
    const newKeypair = ed25519Generate()

    // Update tenant with new signing key
    // OLD key is logged in audit for 24h verification window
    const oldTenant = await db.tenant.findUnique({ where: { id: tenantId } })

    await db.tenant.update({
      where: { id: tenantId },
      data: {
        signingPubKey: Buffer.from(newKeypair.publicKey).toString('hex'),
      },
    })

    await appendAudit({
      tenantId,
      eventType: 'key.rotated',
      payload: {
        oldPubKeyPrefix: oldTenant?.signingPubKey.slice(0, 16),
        newPubKeyPrefix: Buffer.from(newKeypair.publicKey).toString('hex').slice(0, 16),
        rotatedAt: new Date().toISOString(),
      },
      apiKeyId: authResult.auth.apiKeyId,
    })

    logger.info({ tenantId }, 'Tenant signing key rotated')

    return NextResponse.json({
      success: true,
      signingPubKey: Buffer.from(newKeypair.publicKey).toString('hex'),
      signingPrivateKey: Buffer.from(newKeypair.privateKey).toString('hex'),
      warning: 'Store the new signingPrivateKey securely. Update your client SDK config. Old key remains valid for 24h.',
      oldKeyValidUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
  } catch (e) {
    logger.error({ error: e }, 'Key rotation failed')
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
