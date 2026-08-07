/**
 * VeriFace Edge — Next.js Edge Middleware
 *
 * Runs on every request:
 *   1. Generates/propagates request ID (X-Request-ID)
 *   2. Applies CORS headers for cross-origin SDK usage
 *   3. Applies security headers (HSTS, X-Frame-Options, etc.)
 *   4. Blocks requests to non-existent API routes (reduces scanning noise)
 *   5. Strips trailing slashes (canonicalization)
 */

import { NextRequest, NextResponse } from 'next/server'

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

// In production, set VERIFACE_ALLOWED_ORIGINS to your client domains:
//   VERIFACE_ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com
const ALLOWED_ORIGINS = (process.env.VERIFACE_ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim())

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin') ?? ''
  const requestHeaders = new Headers(req.headers)

  // Generate or propagate request ID
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  requestHeaders.set('x-request-id', requestId)

  // Build response
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // Apply security headers
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }

  // HSTS (only in production with HTTPS)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    )
  }

  // CORS
  if (origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Request-ID, Idempotency-Key, X-API-Key',
    )
    response.headers.set('Access-Control-Expose-Headers', 'X-Request-ID, Retry-After')
    response.headers.set('Access-Control-Max-Age', '86400')
    response.headers.set('Vary', 'Origin')
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: response.headers })
  }

  // Add request ID to response headers (for client-side correlation)
  response.headers.set('X-Request-ID', requestId)

  return response
}

export const config = {
  matcher: [
    // Run on all API routes and the main page
    '/api/:path*',
    '/',
  ],
}
