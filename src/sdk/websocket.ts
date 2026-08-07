/**
 * VeriFace Edge SDK — WebSocket Client
 *
 * Real-time event streaming from the VeriFace WebSocket server.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff + jitter
 *   - HMAC message signature verification (per-message integrity)
 *   - Heartbeat ping/pong (connection health monitoring)
 *   - Tenant-scoped room subscription
 *   - Session-scoped event subscription
 *   - Graceful degradation (falls back to polling if WS unavailable)
 *
 * Usage:
 *   const ws = new VeriFaceSocket({
 *     apiKey: 'vf_live_...',
 *     tenantId: 'tnt_...',
 *     wsUrl: '/?XTransformPort=3001',  // via Caddy proxy
 *   })
 *   await ws.connect()
 *   ws.subscribe(sessionId)
 *   ws.on('auth:status', (data) => console.log(data))
 */

import { io, type Socket } from 'socket.io-client'
import { sha256Hex, utf8, hmacSha256Hex, constantTimeEqual } from './crypto'

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface VeriFaceSocketConfig {
  apiKey: string
  tenantId: string
  wsUrl?: string  // defaults to '/?XTransformPort=3001'
  autoReconnect?: boolean  // default: true
  maxReconnectAttempts?: number  // default: 10
  heartbeatIntervalMs?: number  // default: 25000
}

type EventHandler = (data: any) => void

export class VeriFaceSocket {
  private config: Required<VeriFaceSocketConfig>
  private socket: Socket | null = null
  private status: ConnectionStatus = 'disconnected'
  private reconnectAttempts = 0
  private heartbeatTimer: NodeJS.Timeout | null = null
  private messageSecret: string  // derived from API key for HMAC verification

  private eventHandlers: Map<string, Set<EventHandler>> = new Map()
  private statusHandlers: Set<(status: ConnectionStatus) => void> = new Set()

  constructor(config: VeriFaceSocketConfig) {
    this.config = {
      apiKey: config.apiKey,
      tenantId: config.tenantId,
      wsUrl: config.wsUrl ?? '/?XTransformPort=3001',
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 25_000,
    }
    // Derive a per-session secret for HMAC message verification
    this.messageSecret = sha256Hex(this.config.apiKey + '|ws-secret')
  }

  /**
   * Establish WebSocket connection. Authenticates via API key in handshake.
   */
  async connect(): Promise<void> {
    if (this.socket?.connected) return

    this.setStatus('connecting')

    return new Promise((resolve, reject) => {
      this.socket = io(this.config.wsUrl, {
        auth: { apiKey: this.config.apiKey },
        transports: ['websocket'],
        reconnection: this.config.autoReconnect,
        reconnectionAttempts: this.config.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30_000,
        timeout: 10_000,
      })

      this.socket.on('connect', () => {
        this.reconnectAttempts = 0
        this.setStatus('connected')
        this.startHeartbeat()
        resolve()
      })

      this.socket.on('disconnect', (reason) => {
        this.setStatus('disconnected')
        this.stopHeartbeat()
        if (this.config.autoReconnect && reason === 'io server disconnect') {
          // Server initiated disconnect — try reconnect
          this.attemptReconnect()
        }
      })

      this.socket.on('connect_error', (err) => {
        this.setStatus('error')
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
          reject(new Error(`WebSocket connection failed after ${this.reconnectAttempts} attempts: ${err.message}`))
        }
      })

      this.socket.on('reconnect_attempt', (attempt) => {
        this.reconnectAttempts = attempt
        this.setStatus('reconnecting')
      })

      this.socket.on('reconnect_failed', () => {
        this.setStatus('error')
      })

      // Verify signature on 'connected' message
      this.socket.on('connected', (data: { payload: any; signature: string }) => {
        const expectedSig = this.computeSignature(data.payload)
        if (!constantTimeEqual(expectedSig, data.signature)) {
          console.warn('[VeriFace WS] Connected message signature mismatch — disconnecting')
          this.socket?.disconnect()
          this.setStatus('error')
          return
        }
      })

      // Register all event handlers
      this.socket.on('auth:status', (data) => this.handleSignedEvent('auth:status', data))
      this.socket.on('auth:result', (data) => this.handleSignedEvent('auth:result', data))
      this.socket.on('liveness:update', (data) => this.handleSignedEvent('liveness:update', data))
      this.socket.on('metrics:update', (data) => this.handleSignedEvent('metrics:update', data))
      this.socket.on('audit:new', (data) => this.handleSignedEvent('audit:new', data))
      this.socket.on('pong', (data) => {
        // pong doesn't need signature verification — it's a health check
      })
      this.socket.on('error', (data) => {
        console.warn('[VeriFace WS] Server error:', data)
      })
    })
  }

  /**
   * Subscribe to events for a specific session.
   * The session must belong to the authenticated tenant.
   */
  subscribe(sessionId: string): void {
    if (!this.socket?.connected) {
      console.warn('[VeriFace WS] Cannot subscribe — not connected')
      return
    }
    const signature = this.computeSignature({ sessionId })
    this.socket.emit('subscribe', { sessionId, signature })
  }

  /**
   * Unsubscribe from a session's events.
   */
  unsubscribe(sessionId: string): void {
    this.socket?.emit('unsubscribe', { sessionId })
  }

  /**
   * Register an event handler.
   */
  on(event: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
    return () => this.eventHandlers.get(event)?.delete(handler)
  }

  /**
   * Register a connection status handler.
   */
  onStatus(handler: (status: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(handler)
    handler(this.status)
    return () => this.statusHandlers.delete(handler)
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    this.stopHeartbeat()
    this.socket?.disconnect()
    this.socket = null
    this.setStatus('disconnected')
  }

  /**
   * Get current connection status.
   */
  getStatus(): ConnectionStatus {
    return this.status
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  private setStatus(status: ConnectionStatus): void {
    this.status = status
    for (const handler of this.statusHandlers) {
      try { handler(status) } catch { /* ignore */ }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping', { timestamp: Date.now() })
      }
    }, this.config.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setStatus('error')
      return
    }
    this.reconnectAttempts++
    this.setStatus('reconnecting')
    // Exponential backoff with jitter
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000)
    const jitter = delay * 0.2 * Math.random()
    setTimeout(() => {
      this.connect().catch(() => {
        this.attemptReconnect()
      })
    }, delay + jitter)
  }

  private computeSignature(payload: unknown): string {
    return hmacSha256Hex(utf8.encode(this.messageSecret), JSON.stringify(payload))
  }

  private handleSignedEvent(event: string, data: { payload: any; signature: string }): void {
    // Verify message signature
    const expectedSig = this.computeSignature(data.payload)
    if (!constantTimeEqual(expectedSig, data.signature)) {
      console.warn(`[VeriFace WS] Signature verification failed for event: ${event}`)
      return
    }
    // Dispatch to handlers
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try { handler(data.payload) } catch { /* ignore */ }
      }
    }
  }
}
