/**
 * VeriFace Edge — React Native useVeriFace Hook
 *
 * Imperative API for apps that want full control over the UI. Renders a
 * hidden WebView that hosts the web SDK, and exposes start()/cancel()/
 * setTelemetryOptIn() methods plus status/result state.
 *
 * Usage:
 *   const { status, result, error, start, cancel } = useVeriFace({
 *     tenantId: 'tnt_...',
 *     apiKey: 'vf_live_...',
 *     flow: 'authenticate',
 *     externalUserId: 'user_123',
 *   })
 *
 *   return (
 *     <View>
 *       <VeriFaceHiddenView ref={ref} config={config} ... />
 *       <Button title="Start" onPress={start} />
 *       {status === 'capturing' && <Text>Look at the camera...</Text>}
 *       {result && <Text>Success! Token: {result.token}</Text>}
 *     </View>
 *  )
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { VeriFaceView, type VeriFaceViewRef } from './VeriFaceView'
import type {
  VeriFaceConfig,
  VeriFaceResult,
  VeriFaceStatus,
  VeriFaceErrorCode,
} from './types'

export interface UseVeriFaceResult {
  /** Current SDK status (idle → initializing → capturing → success/failed) */
  status: VeriFaceStatus
  /** Final result (set on success) */
  result: VeriFaceResult | null
  /** Error info (set on failure) */
  error: { code: VeriFaceErrorCode; message: string } | null
  /** Whether the SDK is currently busy (status is one of the in-progress states) */
  isBusy: boolean
  /** Start the authentication/enrollment flow */
  start: () => Promise<void>
  /** Cancel any in-progress capture */
  cancel: () => void
  /** Toggle anonymous telemetry (requires WebView reload) */
  setTelemetryOptIn: (optIn: boolean) => void
  /** Hidden VeriFaceView component to render in your JSX */
  VeriFaceHiddenView: React.FC<{ style?: import('react-native').ViewStyle }>
}

const BUSY_STATES: VeriFaceStatus[] = [
  'initializing',
  'requesting-camera',
  'scanning-devices',
  'capturing',
  'processing',
  'committing',
  'verifying',
]

export function useVeriFace(config: VeriFaceConfig): UseVeriFaceResult {
  const ref = useRef<VeriFaceViewRef>(null)
  const [status, setStatus] = useState<VeriFaceStatus>('idle')
  const [result, setResult] = useState<VeriFaceResult | null>(null)
  const [error, setError] = useState<{ code: VeriFaceErrorCode; message: string } | null>(null)

  // Reset state when config changes
  useEffect(() => {
    setStatus('idle')
    setResult(null)
    setError(null)
  }, [config.tenantId, config.apiKey, config.flow, config.externalUserId])

  const start = useCallback(async () => {
    setResult(null)
    setError(null)
    setStatus('initializing')
    await ref.current?.start()
  }, [])

  const cancel = useCallback(() => {
    ref.current?.cancel()
    setStatus('idle')
  }, [])

  const setTelemetryOptIn = useCallback((optIn: boolean) => {
    ref.current?.setTelemetryOptIn(optIn)
  }, [])

  // Hidden VeriFaceView component (zero-size, offscreen)
  const VeriFaceHiddenView = useCallback(
    (props: { style?: import('react-native').ViewStyle }) => (
      <VeriFaceView
        ref={ref}
        {...config}
        showUi={false}
        autoStart={false}
        style={[{ position: 'absolute', width: 1, height: 1, opacity: 0, top: -9999, left: -9999 }, props.style]}
        onSuccess={(r) => {
          setResult(r)
          setStatus('success')
        }}
        onFailure={(e) => {
          setError(e)
          setStatus('failed')
        }}
        onStatus={(s) => setStatus(s)}
      />
    ),
    [config],
  )

  return {
    status,
    result,
    error,
    isBusy: BUSY_STATES.includes(status),
    start,
    cancel,
    setTelemetryOptIn,
    VeriFaceHiddenView,
  }
}
