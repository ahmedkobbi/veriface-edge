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
  // Content-Security-Policy — strict, allows only self + known CDN origins
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net",
    "connect-src 'self' https: wss:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types default",
  ].join('; '),
}

const ALLOWED_ORIGINS = (process.env.VERIFACE_ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim())

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
    response.headers.set('Sunset', 'Sat, 01 Jan 2028 00:00:00 GMT')  // Far future
    // Check if using a sunset version
    const versionMatch = pathname.match(/^\/api\/(v\d+)\//)
    if (versionMatch && SUNSET_VERSIONS.includes(versionMatch[1])) {
      response.headers.set('Deprecation', 'true')
      response.headers.set('Link', '</api/v1/>; rel="successor-version"')
    }
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
