/**
 * VeriFace Edge — ETag & Conditional Request Support
 *
 * Implements HTTP ETag/If-None-Match for bandwidth-efficient caching.
 * GET endpoints return ETag; clients can send If-None-Match to get 304.
 *
 * Usage:
 *   const etag = computeETag(JSON.stringify(data))
 *   const notModified = checkIfNoneMatch(req, etag)
 *   if (notModified) return new Response(null, { status: 304, headers: { ETag: etag } })
 */

import { NextRequest, NextResponse } from 'next/server'
import { sha256Hex } from '@/lib/crypto-server'

/**
 * Compute a weak ETag from response body.
 * Format: W/"<sha256-prefix>"
 */
export function computeETag(body: string): string {
  const hash = sha256Hex(body)
  return `W/"${hash.slice(0, 32)}"`
}

/**
 * Check if the client's If-None-Match header matches our ETag.
 * If so, return a 304 Not Modified response (no body).
 */
export function checkIfNoneMatch(
  req: NextRequest,
  etag: string,
): NextResponse | null {
  const ifNoneMatch = req.headers.get('if-none-match')
  if (!ifNoneMatch) return null

  // Support multiple ETags in header (comma-separated)
  const clientETags = ifNoneMatch.split(',').map((e) => e.trim())
  if (clientETags.includes('*') || clientETags.includes(etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  }
  return null
}

/**
 * Wrap a JSON response with ETag header.
 */
export function jsonResponseWithETag(
  data: unknown,
  status: number = 200,
  extraHeaders?: Record<string, string>,
): NextResponse {
  const body = JSON.stringify(data)
  const etag = computeETag(body)
  return NextResponse.json(data, {
    status,
    headers: {
      ETag: etag,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...extraHeaders,
    },
  })
}
