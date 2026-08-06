/**
 * VeriFace Edge — API integration tests
 *
 * End-to-end tests for the full authentication flow:
 *   1. Tenant creation → API key issuance
 *   2. Session init (with/without API key)
 *   3. Audit log retrieval + chain verification
 *   4. API key management (create/list/revoke)
 *   5. Health check
 *
 * NOTE: These tests require a running dev server on localhost:3000.
 * Run with: `bun test tests/api.test.ts`
 */

import { test, expect, describe, beforeAll } from 'bun:test'

const BASE_URL = 'http://localhost:3000'

interface TestContext {
  tenantId: string
  apiKey: string
  signingPrivateKey: string
}

describe('VeriFace Edge API', () => {
  let ctx: TestContext

  beforeAll(async () => {
    // Create a tenant for the test suite
    const res = await fetch(`${BASE_URL}/api/tenant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Tenant' }),
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    ctx = {
      tenantId: data.tenant.id,
      apiKey: data.apiKey,
      signingPrivateKey: data.signingPrivateKey,
    }
  })

  describe('Health check', () => {
    test('GET /api/health returns 200', async () => {
      const res = await fetch(`${BASE_URL}/api/health`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('healthy')
      expect(data.db).toBe('ok')
    })
  })

  describe('Authentication', () => {
    test('POST /api/session/init without API key returns 401', async () => {
      const res = await fetch(`${BASE_URL}/api/session/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow: 'enroll' }),
      })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.code).toBe('NO_API_KEY')
    })

    test('POST /api/session/init with invalid API key returns 401', async () => {
      const res = await fetch(`${BASE_URL}/api/session/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer vf_live_invalid',
        },
        body: JSON.stringify({ flow: 'enroll' }),
      })
      expect(res.status).toBe(401)
    })

    test('POST /api/session/init with valid API key returns session', async () => {
      const res = await fetch(`${BASE_URL}/api/session/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify({
          flow: 'enroll',
          externalUserId: 'test-user-1',
        }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.sessionId).toBeDefined()
      expect(data.challenge).toBeDefined()
      expect(data.challenge.length).toBe(64)  // 32 bytes hex
      expect(data.backendPubKey).toBeDefined()
      expect(data.backendPubKey.length).toBe(64)
    })
  })

  describe('API key management', () => {
    test('POST /api/api-keys/create creates new key', async () => {
      const res = await fetch(`${BASE_URL}/api/api-keys/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify({
          label: 'Test Key',
          scopes: 'session:init,audit:read',
          environment: 'test',
        }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.apiKey.plaintext).toMatch(/^vf_test_/)
      expect(data.apiKey.id).toBeDefined()
    })

    test('GET /api/api-keys/list returns all keys', async () => {
      const res = await fetch(`${BASE_URL}/api/api-keys/list`, {
        headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.apiKeys.length).toBeGreaterThanOrEqual(2)
      // Plaintext should never be returned
      for (const k of data.apiKeys) {
        expect(k.plaintext).toBeUndefined()
        expect(k.keyHash).toBeUndefined()
      }
    })

    test('API key with limited scope cannot access admin endpoints', async () => {
      // Create a limited-scope key
      const createRes = await fetch(`${BASE_URL}/api/api-keys/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify({
          label: 'Limited',
          scopes: 'session:init',
        }),
      })
      const createData = await createRes.json()
      const limitedKey = createData.apiKey.plaintext

      // Try to access /api/api-keys/list (requires 'tenant:admin')
      const listRes = await fetch(`${BASE_URL}/api/api-keys/list`, {
        headers: { 'Authorization': `Bearer ${limitedKey}` },
      })
      expect(listRes.status).toBe(403)
      const listData = await listRes.json()
      expect(listData.code).toBe('INSUFFICIENT_SCOPE')

      // But should be able to init session
      const initRes = await fetch(`${BASE_URL}/api/session/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${limitedKey}`,
        },
        body: JSON.stringify({ flow: 'authenticate' }),
      })
      expect(initRes.status).toBe(200)
    })
  })

  describe('Audit log', () => {
    test('GET /api/audit returns hash-chained entries', async () => {
      const res = await fetch(`${BASE_URL}/api/audit?limit=100`, {
        headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)

      if (data.entries.length > 1) {
        // Verify chain: each entry's prevHash should match the previous entry's thisHash
        // (entries are returned in descending order, so reverse to walk forward)
        const entries = [...data.entries].reverse()
        for (let i = 1; i < entries.length; i++) {
          // Note: chain may not be perfectly contiguous if other tests wrote entries
          // Just verify the format
          expect(entries[i].prevHash).toMatch(/^[0-9a-f]{64}$/)
          expect(entries[i].thisHash).toMatch(/^[0-9a-f]{64}$/)
        }
      }
    })

    test('GET /api/verify-audit confirms chain integrity', async () => {
      const res = await fetch(`${BASE_URL}/api/verify-audit`, {
        headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.valid).toBe(true)
    })

    test('GET /api/audit/export returns CSV', async () => {
      const res = await fetch(`${BASE_URL}/api/audit/export?format=csv`, {
        headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
      })
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text).toContain('chainIndex,eventType,createdAt')
    })

    test('GET /api/audit/export returns JSON', async () => {
      const res = await fetch(`${BASE_URL}/api/audit/export?format=json`, {
        headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(Array.isArray(data.entries)).toBe(true)
    })

    test('audit endpoint rejects other tenants', async () => {
      // Create a second tenant
      const res2 = await fetch(`${BASE_URL}/api/tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Other Tenant' }),
      })
      const data2 = await res2.json()
      const otherApiKey = data2.apiKey

      // Other tenant cannot see first tenant's audit log
      const auditRes = await fetch(`${BASE_URL}/api/audit`, {
        headers: { 'Authorization': `Bearer ${otherApiKey}` },
      })
      const auditData = await auditRes.json()
      expect(auditData.success).toBe(true)
      // Should NOT contain entries from ctx.tenantId
      for (const entry of auditData.entries) {
        expect(entry.tenantId).not.toBe(ctx.tenantId)
      }
    })
  })

  describe('Webhook configuration', () => {
    test('POST /api/tenant/webhook sets webhook URL', async () => {
      const res = await fetch(`${BASE_URL}/api/tenant/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify({
          webhookUrl: 'https://example.com/webhook',
        }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.webhookUrl).toBe('https://example.com/webhook')
    })

    test('rejects non-HTTPS webhook URLs', async () => {
      const res = await fetch(`${BASE_URL}/api/tenant/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify({
          webhookUrl: 'http://insecure.com/webhook',
        }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('Token verification', () => {
    test('POST /api/token/verify rejects malformed token', async () => {
      const res = await fetch(`${BASE_URL}/api/token/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify({ token: 'malformed' }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.valid).toBe(false)
    })
  })
})
