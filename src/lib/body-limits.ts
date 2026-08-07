/**
 * VeriFace Edge — Request Body Size Limiter
 *
 * Prevents oversized payloads from causing DoS.
 * Default limit: 1MB for API routes (embeddings are ~4KB encrypted).
 */

import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024  // 1MB

export async function checkBodySize(
  req: NextRequest,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<NextResponse | null> {
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
  if (contentLength > maxBytes) {
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
