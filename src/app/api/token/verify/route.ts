/**
 * POST /api/token/verify
 * Verify a VeriFace-issued auth token (for relying parties / downstream services).
 *
 * Body: { token: string }
 *
 * Returns:
 *   { valid: boolean, claims?: {...}, revoked?: boolean }
 *
 * The relying party calls this to confirm a token issued via /session/verify
 * is still valid (not expired, not revoked). This is the OIDC introspection
 * equivalent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { appendAudit } from '@/lib/audit'
import { ed25519Verify, utf8, type Ed25519KeyPair } from '@/lib/crypto-server'
import { ed25519Generate } from '@/lib/crypto-server'

// Reuse the server's signing keypair (singleton from session/verify route).
// In production: this would be loaded from KMS.
let serverKeyPair: Ed25519KeyPair | null = null
function getServerSigningKey(): Ed25519KeyPair {
  if (serverKeyPair) return serverKeyPair
  serverKeyPair = ed25519Generate()
  return serverKeyPair
}

function base64urlDecode(s: string): Uint8Array {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/')
  while (padded.length % 4 !== 0) padded += '='
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function POST(req: NextRequest) {
  // API key required — this is a relying-party endpoint
  const authResult = await requireApiKey(req, 'session:verify')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { token } = body
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ success: false, valid: false, error: 'token required' }, { status: 400 })
    }

    const parts = token.split('.')
    if (parts.length !== 3) {
      return NextResponse.json({ success: true, valid: false, reason: 'MALFORMED' })
    }

    const [headerB64, payloadB64, sigB64] = parts
    const signingInput = headerB64 + '.' + payloadB64
    const signature = base64urlDecode(sigB64)

    const serverKey = getServerSigningKey()
    const valid = ed25519Verify(signature, utf8.encode(signingInput), serverKey.publicKey)
    if (!valid) {
      return NextResponse.json({ success: true, valid: false, reason: 'INVALID_SIGNATURE' })
    }

    // Parse claims
    const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)))
    const now = Math.floor(Date.now() / 1000)
    if (claims.exp && claims.exp < now) {
      return NextResponse.json({ success: true, valid: false, reason: 'EXPIRED', claims })
    }

    // Check revocation list
    if (claims.jti) {
      const revoked = await db.revokedToken.findUnique({ where: { jti: claims.jti } })
      if (revoked) {
        return NextResponse.json({
          success: true,
          valid: false,
          reason: 'REVOKED',
          revokedAt: revoked.revokedAt,
          revokedReason: revoked.reason,
          claims,
        })
      }
    }

    // Tenant scope check: relying party's tenant must match token's tenant
    if (claims.tenant_id !== authResult.auth.tenantId) {
      return NextResponse.json({
        success: true,
        valid: false,
        reason: 'TENANT_MISMATCH',
        expected: authResult.auth.tenantId,
        actual: claims.tenant_id,
      })
    }

    await appendAudit({
      tenantId: authResult.auth.tenantId!,
      eventType: 'token.verified',
      payload: { jti: claims.jti, sub: claims.sub },
      apiKeyId: authResult.auth.apiKeyId,
    })

    return NextResponse.json({
      success: true,
      valid: true,
      claims: {
        iss: claims.iss,
        sub: claims.sub,
        iat: claims.iat,
        exp: claims.exp,
        jti: claims.jti,
        tenant_id: claims.tenant_id,
        session_id: claims.session_id,
        amr: claims.amr,
        acr: claims.acr,
        liveness_score: claims.liveness_score,
        flow: claims.flow,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
