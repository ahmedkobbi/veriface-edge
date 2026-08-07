'use client'

/**
 * VeriFace Edge SDK — WebSocket React Hook
 *
 * Provides real-time auth status updates via WebSocket.
 * Falls back gracefully if WebSocket server is unavailable.
 *
 * Usage:
 *   const { status, subscribe, liveness } = useWebSocket({
 *     apiKey: 'vf_live_...',
 *     tenantId: 'tnt_...',
 *   })
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { VeriFaceSocket, type ConnectionStatus } from './websocket'

export interface UseWebSocketOptions {
  apiKey?: string
  tenantId?: string
  wsUrl?: string
  autoConnect?: boolean  // default: true
}

export interface UseWebSocketReturn {
  status: ConnectionStatus
  subscribe: (sessionId: string) => void
  unsubscribe: (sessionId: string) => void
  on: (event: string, handler: (data: any) => void) => () => void
  disconnect: () => void
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const socketRef = useRef<VeriFaceSocket | null>(null)

  const { apiKey, tenantId, wsUrl, autoConnect = true } = options

  useEffect(() => {
    if (!apiKey || !tenantId || !autoConnect) return

    const socket = new VeriFaceSocket({
      apiKey,
      tenantId,
      wsUrl: wsUrl ?? '/?XTransformPort=3001',
    })

    const unsubStatus = socket.onStatus((s) => setStatus(s))

    socket.connect().catch((err) => {
      console.warn('[useWebSocket] Connection failed:', err)
      setStatus('error')
    })

    socketRef.current = socket

    return () => {
      unsubStatus()
      socket.disconnect()
      socketRef.current = null
    }
  }, [apiKey, tenantId, wsUrl, autoConnect])

  const subscribe = useCallback((sessionId: string) => {
    socketRef.current?.subscribe(sessionId)
  }, [])

  const unsubscribe = useCallback((sessionId: string) => {
    socketRef.current?.unsubscribe(sessionId)
  }, [])

  const on = useCallback((event: string, handler: (data: any) => void) => {
    return socketRef.current?.on(event, handler) ?? (() => {})
  }, [])

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect()
  }, [])

  return { status, subscribe, unsubscribe, on, disconnect }
}

/**
 * Simpler hook: just returns the WebSocket connection status.
 * Used in the header badge.
 */
export function useWebSocketStatus(): ConnectionStatus {
  // For the demo, we don't have a real API key at the top level.
  // This hook attempts a connection and reports status.
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')

  useEffect(() => {
    // Check if WebSocket server is reachable
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health?XTransformPort=3001', { signal: AbortSignal.timeout(2000) })
        if (res.ok) {
          setStatus('connected')
        } else {
          setStatus('disconnected')
        }
      } catch {
        setStatus('disconnected')
      }
    }
    checkHealth()
    const interval = setInterval(checkHealth, 30_000)
    return () => clearInterval(interval)
  }, [])

  return status
}
