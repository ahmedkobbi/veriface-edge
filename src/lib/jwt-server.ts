/**
 * Server-side JWT signing (Ed25519)
 * Mirrors the SDK's JWT format.
 */

import { ed25519Sign, utf8 } from '@/lib/crypto-server'
import type { JwtClaims } from '@/lib/crypto-server'

function base64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function signJwt(claims: JwtClaims, privateKey: Uint8Array): string {
  const header = { alg: 'EdDSA' as const, typ: 'JWT' as const }
  const headerB64 = base64urlEncode(utf8.encode(JSON.stringify(header)))
  const payloadB64 = base64urlEncode(utf8.encode(JSON.stringify(claims)))
  const signingInput = headerB64 + '.' + payloadB64
  const signature = ed25519Sign(utf8.encode(signingInput), privateKey)
  const sigB64 = base64urlEncode(signature)
  return signingInput + '.' + sigB64
}
