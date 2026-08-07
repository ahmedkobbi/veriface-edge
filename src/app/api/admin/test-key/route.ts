/**
 * POST /api/admin/test-key
 * Developer Console: test an API key against a VeriFace endpoint.
 * Returns the raw HTTP response for debugging.
 *
 * Body: { method, path, body? }
 * Uses the tenant's first active API key to make the request.
 * Protected by platform session cookie.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { logger } from '@/lib/logger'

const ALLOWED_METHODS = ['GET', 'POST']
const ALLOWED_PATH_PREFIX = '/api/'

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response
  const { tenantId } = session

  const { method, path, body: requestBody } = await req.json()

  // Validate
  if (!method || !ALLOWED_METHODS.includes(method)) {
    return NextResponse.json({ success: false, error: 'Method must be GET or POST' }, { status: 400 })
  }
  if (!path || !path.startsWith(ALLOWED_PATH_PREFIX)) {
    return NextResponse.json({ success: false, error: 'Path must start with /api/' }, { status: 400 })
  }

  // Get an active API key for the tenant
  const apiKey = await db.apiKey.findFirst({
    where: { tenantId, active: true },
    orderBy: { createdAt: 'desc' },
  })

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'No active API key found for this tenant' }, { status: 404 })
  }

  // We can't use the plaintext (it's hashed) — use the session cookie instead
  // by making a server-to-server request with the X-Tenant-Id header
  const baseUrl = process.env.NODE_ENV === 'production' ? `https://${req.headers.get('host')}` : 'http://localhost:3000'
  const url = baseUrl + path

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
      },
    }

    if (method === 'POST' && requestBody) {
      fetchOptions.body = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody)
    }

    const start = Date.now()
    const response = await fetch(url, fetchOptions)
    const duration = Date.now() - start
    const responseText = await response.text()

    let responseData: any
    try { responseData = JSON.parse(responseText) } catch { responseData = responseText }

    return NextResponse.json({
      success: true,
      result: {
        status: response.status,
        statusText: response.statusText,
        durationMs: duration,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseData,
      },
    })
  } catch (e) {
    logger.error({ error: e, path, method }, 'Test-key request failed')
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Request failed',
    }, { status: 500 })
  }
}
