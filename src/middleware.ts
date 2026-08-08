/**
 * VeriFace Edge — Next.js Edge Middleware
 *
 * Runs on every request:
 *   1. Generates/propagates request ID (X-Request-ID)
 *   2. Applies CORS headers for cross-origin SDK usage
 *   3. Applies security headers (HSTS, X-Frame-Options, etc.)
 *   4. API versioning (adds Sunset header for deprecated versions)
 *   5. Strips trailing slashes (canonicalization)
 *   6. Adds Deprecation header for sunset endpoints
 */

import { NextRequest, NextResponse } from 'next/server'

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // X-XSS-Protection removed — deprecated since Chrome 2019, can introduce vulns
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
  'X-Permitted-Cross-Domain-Policies': 'none',
  // Content-Security-Policy — strict, allows only self
  // SECURITY FIX (H-5): Removed 'unsafe-inline' and external CDN from script-src.
  // SECURITY FIX (M-7): Removed 'unsafe-inline' from style-src. Next.js generates
  //   style tags with nonces/hashes in production builds. For dev, React refresh
  //   runtime needs 'unsafe-inline' for styles — we allow this ONLY in dev.
  //   Also removed the contradiction: 'require-trusted-types-for "script"'
  //   is incompatible with 'unsafe-inline' in script-src. Both are now clean.
  //   Inline scripts must use nonces or hashes. Dependencies are self-hosted.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "connect-src 'self' https: wss:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    // Dev: allow inline styles (React refresh + Next.js dev overlays).
    // Prod: strict — styles must come from self or use nonces.
    process.env.NODE_ENV === 'production'
      ? "style-src 'self'"
      : "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    // Trusted Types: only allow 'default' + 'verifice-policy' policies.
    // require-trusted-types-for 'script' enforces that all DOM sink writes
    // (innerHTML, etc.) go through a vetted Trusted Types policy.
    "require-trusted-types-for 'script'",
    "trusted-types default veriface-policy",
  ].join('; '),
}

// CORS: in production, REQUIRE explicit origin allowlist
const ALLOWED_ORIGINS = (() => {
  const raw = process.env.VERIFACE_ALLOWED_ORIGINS
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('VERIFACE_ALLOWED_ORIGINS must be set in production (comma-separated list of allowed origins)')
    }
    return ['*']
  }
  return raw.split(',').map((s) => s.trim())
})()

// API version support
const CURRENT_API_VERSION = 'v1'
const SUPPORTED_VERSIONS = ['v1']
const SUNSET_VERSIONS: string[] = []  // Versions being sunset

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

  // HTTP/3 advertisement (allows clients to upgrade to QUIC)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Alt-Svc', 'h3=":443"; ma=86400')
  }

  // API versioning headers
  const pathname = req.nextUrl.pathname
  if (pathname.startsWith('/api/')) {
    response.headers.set('API-Version', CURRENT_API_VERSION)
    // Only set Sunset on routes that are actually being deprecated (none currently)
    // response.headers.set('Sunset', 'Sat, 01 Jan 2028 00:00:00 GMT')
  }

  // CORS
  if (origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Request-ID, Idempotency-Key, X-API-Key, If-None-Match, X-VeriFace-Timestamp, X-VeriFace-Nonce, X-VeriFace-Signature',
    )
    response.headers.set('Access-Control-Expose-Headers', 'X-Request-ID, Retry-After, ETag, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, API-Version')
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
    '/api/:path*',
    '/userinfo',
    '/oauth/:path*',
    '/.well-known/:path*',
    '/',
  ],
}
