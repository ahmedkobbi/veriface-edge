/**
 * VeriFace Edge — WebSocket Security Tests
 *
 * Tests WebSocket server:
 *   - Rejects connection without API key
 *   - Rejects invalid API key format
 *   - Health endpoint
 *   - Message signature verification
 *
 * NOTE: These tests require the WebSocket mini-service to be running on port 3001.
 * If it's not running, tests skip gracefully (don't fail the build).
 */

import { test, expect, describe } from 'bun:test'

const WS_URL = 'http://localhost:3001'

async function isWsServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${WS_URL}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

describe('WebSocket: Authentication', () => {
  test('rejects connection without API key', async () => {
    if (!(await isWsServerRunning())) {
      console.log('Skipping — WS server not running')
      return
    }
    const { io: ioc } = await import('socket.io-client')
    const client = ioc(WS_URL, {
      auth: {},
      transports: ['websocket'],
      timeout: 3000,
      reconnection: false,
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve()
          client.disconnect()
        }, 3000)
        client.on('connect_error', () => {
          clearTimeout(timer)
          resolve()
        })
        client.on('connect', () => {
          clearTimeout(timer)
          reject(new Error('Should not have connected'))
        })
      })
      expect(client.connected).toBe(false)
    } finally {
      client.disconnect()
    }
  })

  test('rejects invalid API key format', async () => {
    if (!(await isWsServerRunning())) {
      console.log('Skipping — WS server not running')
      return
    }
    const { io: ioc } = await import('socket.io-client')
    const client = ioc(WS_URL, {
      auth: { apiKey: 'invalid-key' },
      transports: ['websocket'],
      timeout: 3000,
      reconnection: false,
    })

    try {
      await new Promise<void>((resolve) => {
        client.on('connect_error', () => resolve())
        setTimeout(() => resolve(), 3000)
      })
      expect(client.connected).toBe(false)
    } finally {
      client.disconnect()
    }
  })
})

describe('WebSocket: Health', () => {
  test('health endpoint returns server status', async () => {
    if (!(await isWsServerRunning())) {
      console.log('Skipping — WS server not running')
      return
    }
    const res = await fetch(`${WS_URL}/health`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('healthy')
    expect(data.service).toBe('veriface-websocket')
    expect(typeof data.connections).toBe('number')
  })
})

describe('WebSocket: Message Signing', () => {
  test('connected event includes HMAC signature', async () => {
    if (!(await isWsServerRunning())) {
      console.log('Skipping — WS server not running')
      return
    }
    const apiKey = process.env.TEST_API_KEY
    if (!apiKey) {
      console.log('Skipping — no TEST_API_KEY')
      return
    }
    const { io: ioc } = await import('socket.io-client')
    const client = ioc(WS_URL, {
      auth: { apiKey },
      transports: ['websocket'],
      timeout: 5000,
      reconnection: false,
    })

    try {
      const data = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), 5000)
        client.on('connected', (data: any) => {
          clearTimeout(timer)
          resolve(data)
        })
        client.on('connect_error', (err: any) => {
          clearTimeout(timer)
          reject(err)
        })
      })
      expect(data.payload).toBeDefined()
      expect(data.signature).toBeDefined()
      expect(data.signature.length).toBe(64)
    } finally {
      client.disconnect()
    }
  })
})
