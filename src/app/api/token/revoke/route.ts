/**
 * POST /api/token/revoke
 * Revoke a VeriFace-issued auth token before its natural expiry.
 *
 * Body: { token: string, reason?: string }
 *
 * Adds the token's JTI to the RevokedToken table. The /token/verify
 * endpoint checks this list and rejects revoked tokens.
 *
 * Use cases:
 *   - User logs out (revoke their session token immediately)
 *   - Suspected token theft (revoke + force re-auth)
 *   - Account suspension by admin
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSigningKey } from '@/lib/config'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { appendAudit } from '@/lib/audit'
import { ed25519Verify, utf8, type Ed25519KeyPair, ed25519Generate } from '@/lib/crypto-server'


function base64urlDecode(s: string): Uint8Array {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/')
  while (padded.length % 4 !== 0) padded += '='
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:verify')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { token, reason } = body
    if (!token) {
      return NextResponse.json({ success: false, error: 'token required' }, { status: 400 })
    }

    const parts = token.split('.')
    if (parts.length !== 3) {
      return NextResponse.json({ success: false, error: 'Malformed token' }, { status: 400 })
    }

    const [headerB64, payloadB64, sigB64] = parts
    const signingInput = headerB64 + '.' + payloadB64
    const signature = base64urlDecode(sigB64)

    const serverKey = getServerSigningKey()
    if (!ed25519Verify(signature, utf8.encode(signingInput), serverKey.publicKey)) {
      return NextResponse.json({ success: false, error: 'Invalid token signature' }, { status: 401 })
    }

    const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)))
    if (!claims.jti) {
      return NextResponse.json({ success: false, error: 'Token has no jti' }, { status: 400 })
    }

    // Tenant scope check
    if (claims.tenant_id !== authResult.auth.tenantId) {
      return NextResponse.json({ success: false, error: 'Token does not belong to tenant' }, { status: 403 })
    }

    // Insert into revocation list (idempotent)
    const existing = await db.revokedToken.findUnique({ where: { jti: claims.jti } })
    if (existing) {
      return NextResponse.json({ success: true, revoked: true, alreadyRevoked: true, revokedAt: existing.revokedAt })
    }

    const revoked = await db.revokedToken.create({
      data: {
        jti: claims.jti,
        tenantId: claims.tenant_id,
        reason: reason ?? 'manual_revoke',
        expiresAt: new Date((claims.exp ?? 0) * 1000),
      },
    })

    await appendAudit({
      tenantId: authResult.auth.tenantId!,
      eventType: 'token.revoked',
      payload: { jti: claims.jti, sub: claims.sub, reason: reason ?? 'manual_revoke' },
      apiKeyId: authResult.auth.apiKeyId,
    })

    return NextResponse.json({
      success: true,
      revoked: true,
      revokedAt: revoked.revokedAt,
      expiresAt: revoked.expiresAt,
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
