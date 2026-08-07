/**
 * GET /userinfo
 * OIDC UserInfo Endpoint.
 *
 * Returns claims about the authenticated user.
 * Requires: Authorization: Bearer <access_token>
 *
 * Returns:
 *   { sub, tenant_id, session_id, amr, acr, liveness_score }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSigningKey } from '@/lib/config'
import { db } from '@/lib/db'
import { ed25519Verify, utf8, type Ed25519KeyPair, ed25519Generate } from '@/lib/crypto-server'

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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({
      error: 'invalid_token',
      error_description: 'Bearer token required',
    }, { status: 401 })
  }

  const token = authHeader.slice(7)
  const parts = token.split('.')
  if (parts.length !== 3) {
    return NextResponse.json({
      error: 'invalid_token',
      error_description: 'Malformed token',
    }, { status: 401 })
  }

  const [headerB64, payloadB64, sigB64] = parts
  const signingInput = headerB64 + '.' + payloadB64
  const signature = base64urlDecode(sigB64)

  const serverKey = getServerSigningKey()
  if (!ed25519Verify(signature, utf8.encode(signingInput), serverKey.publicKey)) {
    return NextResponse.json({
      error: 'invalid_token',
      error_description: 'Signature verification failed',
    }, { status: 401 })
  }

  const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)))
  const now = Math.floor(Date.now() / 1000)
  if (claims.exp && claims.exp < now) {
    return NextResponse.json({
      error: 'invalid_token',
      error_description: 'Token expired',
    }, { status: 401 })
  }

  // Look up the session
  const session = await db.session.findUnique({ where: { id: claims.sub } })
  if (!session || session.state !== 'success') {
    return NextResponse.json({
      error: 'invalid_token',
      error_description: 'Session not found or not successful',
    }, { status: 401 })
  }

  // Get user
  const user = session.targetUserId
    ? await db.user.findUnique({ where: { id: session.targetUserId } })
    : null

  if (!user) {
    return NextResponse.json({
      error: 'invalid_token',
      error_description: 'User not found',
    }, { status: 401 })
  }

  return NextResponse.json({
    sub: user.externalUserId,
    tenant_id: claims.tenant_id,
    session_id: session.id,
    amr: ['face'],
    acr: 'eidas:substantial',
    auth_time: claims.iat,
  })
}
