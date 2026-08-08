/**
 * VeriFace Edge — Request Body Size Limiter
 *
 * Prevents oversized payloads from causing DoS.
 * Default limit: 1MB for API routes (embeddings are ~4KB encrypted).
 *
 * SECURITY FIX (M-1): Previously this only checked the Content-Length header,
 * which is client-controlled and can be:
 *   - Spoofed (set lower than the actual body)
 *   - Absent (chunked transfer-encoding)
 *   - Truncated (client sends fewer bytes than declared, blocking the request)
 *
 * The fix uses a two-layer defense:
 *   1. Pre-read header check — fast rejection when Content-Length exceeds limit
 *      (avoids reading the body at all for obviously-too-large requests)
 *   2. Post-read actual-byte check — reads the body with a hard ceiling and
 *      verifies the actual byte count, defeating header spoofing and
 *      chunked-encoding bypass
 *
 * The stream-based enforcer reads up to (maxBytes + 1) bytes; if it reads
 * more than maxBytes, the request is rejected with 413 before the body
 * is fully consumed.
 */

import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024 // 1MB

/**
 * Pre-read check: reject requests whose declared Content-Length exceeds the limit.
 * This is a fast path that avoids reading the body. It is NOT sufficient on its
 * own (header can be spoofed) — pair with enforceBodySize() for full protection.
 */
export async function checkBodySize(
  req: NextRequest,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<NextResponse | null> {
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
  if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
    return NextResponse.json(
      {
        success: false,
        error: `Request body too large: ${contentLength} bytes exceeds limit of ${maxBytes} bytes`,
        code: 'BODY_TOO_LARGE',
      },
      { status: 413 },
    )
  }
  return null
}

/**
 * Read the request body with a hard ceiling. Returns the body as a Buffer
 * or a 413 NextResponse if the body exceeds maxBytes.
 *
 * This is the authoritative check — it counts actual bytes received,
 * defeating Content-Length spoofing and chunked-encoding bypass.
 *
 * Usage in a route handler:
 *   const sizeCheck = await checkBodySize(req, BODY_LIMITS.SESSION_VERIFY)
 *   if (sizeCheck) return sizeCheck
 *   const bodyBuf = await enforceBodySize(req, BODY_LIMITS.SESSION_VERIFY)
 *   if (bodyBuf instanceof NextResponse) return bodyBuf
 *   const body = JSON.parse(bodyBuf.toString('utf-8'))
 */
export async function enforceBodySize(
  req: NextRequest,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<Buffer | NextResponse> {
  // Read up to maxBytes + 1 byte. If we read more than maxBytes, reject.
  // This caps memory usage regardless of how large the actual stream is.
  const reader = req.body?.getReader()
  if (!reader) {
    return Buffer.alloc(0)
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        // Drain the reader to avoid keeping the connection in a half-read state
        try {
          await reader.cancel()
        } catch {
          // Ignore — we're rejecting anyway
        }
        return NextResponse.json(
          {
            success: false,
            error: `Request body too large: actual byte count exceeds limit of ${maxBytes} bytes`,
            code: 'BODY_TOO_LARGE',
          },
          { status: 413 },
        )
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Ignore — already released
    }
  }

  // Concatenate chunks into a single Buffer
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return Buffer.from(merged)
}

export const BODY_LIMITS = {
  SESSION_INIT: 1 * 1024,        // 1KB
  SESSION_VERIFY: 64 * 1024,     // 64KB (encrypted embedding + JWT)
  TENANT_CREATE: 1 * 1024,       // 1KB
  WEBHOOK_CONFIG: 1 * 1024,      // 1KB
  API_KEY_CREATE: 1 * 1024,      // 1KB
  WEBAUTHN_REGISTER: 16 * 1024,  // 16KB (attestation object)
  WEBAUTHN_AUTH: 8 * 1024,       // 8KB (assertion)
  TEMPLATE_DELETE: 1 * 1024,     // 1KB
  TOKEN_VERIFY: 8 * 1024,        // 8KB (JWT)
  DEFAULT: 1 * 1024 * 1024,      // 1MB
} as const
