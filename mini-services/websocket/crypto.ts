/**
 * VeriFace Edge — Shared crypto for WebSocket service
 * Re-exports from the main project's crypto (duplicated for mini-service independence).
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hmac } from '@noble/hashes/hmac.js'

export const utf8 = {
  encode(s: string): Uint8Array {
    return new TextEncoder().encode(s)
  },
  decode(b: Uint8Array): string {
    return new TextDecoder().decode(b)
  },
}

export const hex = {
  encode(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
    return out
  },
  decode(s: string): Uint8Array {
    const out = new Uint8Array(s.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
    return out
  },
}

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input
  return hex.encode(sha256(bytes))
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): string {
  return hex.encode(hmac(sha256, key, message))
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
