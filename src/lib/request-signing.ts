/**
 * VeriFace Edge — HMAC Request Signing (Replay Protection)
 *
 * Every sensitive API request must include:
 *   X-VeriFace-Timestamp: <unix ms>
 *   X-VeriFace-Nonce: <random 32 hex chars>
 *   X-VeriFace-Signature: HMAC-SHA256(apiKey, method + path + timestamp + nonce + body_hash)
 *
 * The server validates:
 *   1. Timestamp is within ±5 minutes (prevents replay after window)
 *   2. Nonce hasn't been seen before (prevents replay within window)
 *   3. Signature matches (proves request came from API key holder)
 *   4. Body hash matches (prevents tampering in transit)
 *
 * This is in ADDITION to the Bearer API key — it prevents an attacker
 * who captures a valid request from replaying it later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { hmacSha256, utf8, sha256Hex } from '@/lib/crypto-server'

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000  // ±5 minutes

// In-memory nonce cache (production: Redis with TTL)
const seenNonces = new Map<string, number>()

// Cleanup expired nonces every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - TIMESTAMP_WINDOW_MS * 2
  for (const [nonce, ts] of seenNonces) {
    if (ts < cutoff) seenNonces.delete(nonce)
  }
}, 5 * 60 * 1000).unref?.()

export interface SignedRequestResult {
  valid: boolean
  reason?: string
  requestId?: string
}

/**
 * Verify HMAC request signature.
 * Called after API key authentication (so we have the plaintext key).
 */
export async function verifyRequestSignature(
  req: NextRequest,
  apiKey: string,
  body: string,
): Promise<SignedRequestResult> {
  const timestamp = req.headers.get('x-veriface-timestamp')
  const nonce = req.headers.get('x-veriface-nonce')
  const signature = req.headers.get('x-veriface-signature')

  if (!timestamp || !nonce || !signature) {
    // For backwards compat, signed requests are optional on GET endpoints
    // but REQUIRED on POST /session/verify (the sensitive one)
    if (req.method === 'POST' && req.nextUrl.pathname.includes('/session/verify')) {
      return { valid: false, reason: 'MISSING_SIGNATURE' }
    }
    return { valid: true }  // Optional for other endpoints
  }

  // 1. Check timestamp window
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) {
    return { valid: false, reason: 'INVALID_TIMESTAMP' }
  }
  const now = Date.now()
  if (Math.abs(now - ts) > TIMESTAMP_WINDOW_MS) {
    return { valid: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' }
  }

  // 2. Check nonce hasn't been used
  if (seenNonces.has(nonce)) {
    return { valid: false, reason: 'NONCE_REUSE' }
  }

  // 3. Compute expected signature
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method
  const bodyHash = sha256Hex(body)
  const signingString = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`
  const expectedSig = hmacSha256(utf8.encode(apiKey), utf8.encode(signingString))

  // 4. Constant-time comparison
  if (expectedSig.length !== signature.length) {
    return { valid: false, reason: 'INVALID_SIGNATURE' }
  }
  let diff = 0
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  if (diff !== 0) {
    return { valid: false, reason: 'INVALID_SIGNATURE' }
  }

  // 5. Mark nonce as used
  seenNonces.set(nonce, now)

  return { valid: true }
}

/**
 * Build signature headers on the client side.
 * Returns headers to add to the fetch request.
 */
export function buildSignatureHeaders(
  method: string,
  path: string,
  body: string,
  apiKey: string,
): Record<string, string> {
  const timestamp = Date.now().toString()
  const nonce = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const bodyHash = sha256Hex(body)
  const signingString = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`
  const signature = hmacSha256(utf8.encode(apiKey), utf8.encode(signingString))

  return {
    'X-VeriFace-Timestamp': timestamp,
    'X-VeriFace-Nonce': nonce,
    'X-VeriFace-Signature': signature,
  }
}
