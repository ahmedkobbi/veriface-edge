/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */

import { NextResponse } from 'next/server'
import { buildClearCookieHeader } from '@/lib/platform-auth'

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.headers.set('Set-Cookie', buildClearCookieHeader())
  return response
}
