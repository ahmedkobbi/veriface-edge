/**
 * POST /api/auth/logout
 * Clears the session cookie + CSRF cookie.
 *
 * SECURITY FIX (I-3): Also clears the CSRF token cookie on logout.
 */

import { NextResponse } from 'next/server'
import { buildClearCookieHeader } from '@/lib/platform-auth'
import { buildClearCsrfCookieHeader } from '@/lib/csrf'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.headers.set('Set-Cookie', buildClearCookieHeader())
  response.headers.append('Set-Cookie', buildClearCsrfCookieHeader())
  return response
}
