/**
 * GET /api/auth/csrf-token
 *
 * Returns a CSRF token for the frontend to use in subsequent state-changing
 * requests (POST, PUT, DELETE) on cookie-authenticated endpoints.
 *
 * The token is set as a non-HttpOnly cookie (so frontend JS can read it)
 * AND returned in the response body (for convenience).
 *
 * Flow:
 *   1. Frontend: GET /api/auth/csrf-token → receives { token }
 *   2. Frontend reads the veriface_csrf cookie (or uses the response body)
 *   3. Frontend includes X-CSRF-Token: <token> on POST/PUT/DELETE requests
 *   4. Server verifies cookie === header (double-submit pattern)
 *
 * SECURITY: This endpoint is safe even for unauthenticated users — the token
 * is just a random value. The CSRF protection kicks in when the token is
 * required to match on state-changing requests.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateCsrfToken, buildCsrfCookieHeader } from '@/lib/csrf'

export async function GET(req: NextRequest) {
  const token = generateCsrfToken()
  const response = NextResponse.json({
    success: true,
    token,
    headerName: 'X-CSRF-Token',
  })
  response.headers.set('Set-Cookie', buildCsrfCookieHeader(token))
  return response
}
