/**
 * VeriFace Edge — Request Signing Tests
 *
 * Tests HMAC request signing for replay protection.
 */

import { test, expect, describe } from 'bun:test'
import { buildSignatureHeaders, verifyRequestSignature } from '../src/lib/request-signing'
import { sha256Hex, hmacSha256, utf8 } from '../src/lib/crypto-server'

// Mock NextRequest for testing
function createMockRequest(opts: {
  method: string
  path: string
  headers?: Record<string, string>
  body: string
}): any {
  const url = `http://localhost:3000${opts.path}`
  return {
    method: opts.method,
    url,
    nextUrl: { pathname: opts.path },
    headers: new Headers(opts.headers ?? {}),
  }
}

describe('Request Signing', () => {
  const apiKey = 'vf_live_' + 'a'.repeat(32)
  const body = JSON.stringify({ flow: 'enroll', externalUserId: 'test' })
  const method = 'POST'
  const path = '/api/session/init'

  test('buildSignatureHeaders produces all required headers', () => {
    const headers = buildSignatureHeaders(method, path, body, apiKey)
    expect(headers['X-VeriFace-Timestamp']).toBeDefined()
    expect(headers['X-VeriFace-Nonce']).toBeDefined()
    expect(headers['X-VeriFace-Signature']).toBeDefined()
    expect(headers['X-VeriFace-Nonce'].length).toBe(48)  // 2 UUIDs concatenated
    expect(headers['X-VeriFace-Signature'].length).toBe(64)  // HMAC-SHA256 hex
  })

  test('valid signature is accepted', async () => {
    const headers = buildSignatureHeaders(method, path, body, apiKey)
    const req = createMockRequest({ method, path, headers, body })
    const result = await verifyRequestSignature(req, apiKey, body)
    expect(result.valid).toBe(true)
  })

  test('tampered body is rejected', async () => {
    const headers = buildSignatureHeaders(method, path, body, apiKey)
    const tamperedBody = JSON.stringify({ flow: 'enroll', externalUserId: 'attacker' })
    const req = createMockRequest({ method, path, headers, body: tamperedBody })
    const result = await verifyRequestSignature(req, apiKey, tamperedBody)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('INVALID_SIGNATURE')
  })

  test('replayed nonce is rejected', async () => {
    const headers = buildSignatureHeaders(method, path, body, apiKey)
    const req1 = createMockRequest({ method, path, headers, body })
    const result1 = await verifyRequestSignature(req1, apiKey, body)
    expect(result1.valid).toBe(true)

    // Replay with same nonce
    const req2 = createMockRequest({ method, path, headers, body })
    const result2 = await verifyRequestSignature(req2, apiKey, body)
    expect(result2.valid).toBe(false)
    expect(result2.reason).toBe('NONCE_REUSE')
  })

  test('expired timestamp is rejected', async () => {
    const headers = buildSignatureHeaders(method, path, body, apiKey)
    // Set timestamp to 10 minutes ago (outside ±5 min window)
    headers['X-VeriFace-Timestamp'] = (Date.now() - 10 * 60 * 1000).toString()
    // Recompute signature with old timestamp
    const nonce = headers['X-VeriFace-Nonce']
    const bodyHash = sha256Hex(body)
    const signingString = `${method}\n${path}\n${headers['X-VeriFace-Timestamp']}\n${nonce}\n${bodyHash}`
    headers['X-VeriFace-Signature'] = hmacSha256(utf8.encode(apiKey), utf8.encode(signingString))

    const req = createMockRequest({ method, path, headers, body })
    const result = await verifyRequestSignature(req, apiKey, body)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('TIMESTAMP_OUT_OF_WINDOW')
  })

  test('wrong API key signature is rejected', async () => {
    const headers = buildSignatureHeaders(method, path, body, apiKey)
    const req = createMockRequest({ method, path, headers, body })
    // Verify with different API key
    const wrongKey = 'vf_live_' + 'b'.repeat(32)
    const result = await verifyRequestSignature(req, wrongKey, body)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('INVALID_SIGNATURE')
  })

  test('GET requests without signature are allowed (optional)', async () => {
    const req = createMockRequest({ method: 'GET', path: '/api/health', body: '' })
    const result = await verifyRequestSignature(req, apiKey, '')
    expect(result.valid).toBe(true)
  })
})

describe('PII Redaction', () => {
  test('redacts email addresses', async () => {
    const { redactPII } = await import('../src/lib/config')
    expect(redactPII('Contact user@example.com for help')).toBe('Contact [EMAIL] for help')
  })

  test('redacts phone numbers', async () => {
    const { redactPII } = await import('../src/lib/config')
    expect(redactPII('Call 555-123-4567')).toBe('Call [PHONE]')
  })

  test('redacts IP addresses', async () => {
    const { redactPII } = await import('../src/lib/config')
    expect(redactPII('From 192.168.1.1')).toBe('From [IP]')
  })

  test('redacts API keys', async () => {
    const { redactPII } = await import('../src/lib/config')
    const key = 'vf_live_' + 'a'.repeat(32)
    expect(redactPII(`Key: ${key}`)).toBe('Key: [API_KEY]')
  })

  test('redacts hex hashes', async () => {
    const { redactPII } = await import('../src/lib/config')
    const hash = 'a'.repeat(64)
    expect(redactPII(`Hash: ${hash}`)).toBe('Hash: [HASH]')
  })

  test('redacts file paths', async () => {
    const { redactPII } = await import('../src/lib/config')
    expect(redactPII('Error at /src/lib/crypto.ts:')).toBe('Error at [FILE]:')
  })

  test('redacts stack traces', async () => {
    const { redactPII } = await import('../src/lib/config')
    const result = redactPII('Error at Object.handler (/app/src/lib/auth.ts:42)')
    expect(result).toContain('[STACK_FRAME]')
    expect(result).toContain('[FILE]')
  })
})

describe('Safe Error Response', () => {
  test('production mode returns generic error', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const { safeErrorResponse } = await import('../src/lib/config')
    const result = safeErrorResponse(new Error('Database connection failed at /app/db.ts:42 with password=secret123'), 'req-123')
    expect(result.error).toBe('An internal error occurred')
    expect(result.code).toBe('INTERNAL_ERROR')
    expect(result.requestId).toBe('req-123')
    process.env.NODE_ENV = originalEnv
  })

  test('development mode returns redacted error', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const { safeErrorResponse } = await import('../src/lib/config')
    const result = safeErrorResponse(new Error('Failed for user@example.com at /app/db.ts:42'))
    expect(result.error).toContain('[EMAIL]')
    expect(result.error).toContain('[FILE]')
    process.env.NODE_ENV = originalEnv
  })
})
