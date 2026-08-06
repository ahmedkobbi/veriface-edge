'use client'

/**
 * VeriFace Edge SDK — React Hook
 *
 * Drop-in React integration for the VeriFace SDK. Exposes:
 *   - status: real-time pipeline status
 *   - liveness: latest liveness scores (updates per frame)
 *   - error: last error (VeriFaceError)
 *   - authenticate(): run full auth flow
 *   - enroll(externalUserId): run full enrollment flow
 *   - cancel(): abort in-progress capture
 *   - videoRef: attach to a <video> element for live preview
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { VeriFace, VeriFaceError, type VeriFaceConfig, type VeriFaceStatus, type VeriFaceLivenessReport, type VeriFaceResult } from './veriface'

export interface UseFaceAuthOptions extends VeriFaceConfig {
  videoRef?: React.RefObject<HTMLVideoElement | null>
  onStatus?: (status: VeriFaceStatus) => void
  onFrame?: (frame: { rppgProgress: number; liveness: VeriFaceLivenessReport | null }) => void
}
export interface UseFaceAuthReturn {
  status: VeriFaceStatus
  liveness: VeriFaceLivenessReport | null
  rppgProgress: number
  error: VeriFaceError | null
  result: VeriFaceResult | null
  authenticate: (externalUserId?: string) => Promise<VeriFaceResult>
  enroll: (externalUserId: string) => Promise<VeriFaceResult>
  cancel: () => void
  videoRef: React.RefObject<HTMLVideoElement | null>
}

export function useFaceAuth(options: UseFaceAuthOptions): UseFaceAuthReturn {
  const [status, setStatus] = useState<VeriFaceStatus>('idle')
  const [liveness, setLiveness] = useState<VeriFaceLivenessReport | null>(null)
  const [rppgProgress, setRppgProgress] = useState(0)
  const [error, setError] = useState<VeriFaceError | null>(null)
  const [result, setResult] = useState<VeriFaceResult | null>(null)

  const sdkRef = useRef<VeriFace | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const videoRef = options.videoRef ?? localVideoRef

  // Initialize SDK on mount
  useEffect(() => {
    if (!options.tenantId || !options.apiKey) return
    const sdk = new VeriFace({
      tenantId: options.tenantId,
      apiKey: options.apiKey,
      apiBaseUrl: options.apiBaseUrl,
      modelVersion: options.modelVersion,
      captureDurationMs: options.captureDurationMs,
      livenessThreshold: options.livenessThreshold,
      highSecurity: options.highSecurity,
      theme: options.theme,
    })

    const unsubStatus = sdk.onStatus((s) => {
      setStatus(s)
      options.onStatus?.(s)
    })
    const unsubFrame = sdk.onFrame((frame) => {
      setLiveness(frame.liveness)
      setRppgProgress(frame.rppgProgress)
      options.onFrame?.({ rppgProgress: frame.rppgProgress, liveness: frame.liveness })
    })

    sdkRef.current = sdk

    return () => {
      unsubStatus()
      unsubFrame()
      sdk.destroy()
      sdkRef.current = null
    }
  }, [options.tenantId, options.apiKey])

  const runFlow = useCallback(async (
    flow: 'enroll' | 'authenticate',
    externalUserId?: string,
  ): Promise<VeriFaceResult> => {
    const sdk = sdkRef.current
    if (!sdk) throw new Error('SDK not initialized')

    setError(null)
    setResult(null)
    setLiveness(null)
    setRppgProgress(0)

    try {
      // 1. Init session FIRST (creates audit entry, doesn't need camera)
      const session = await sdk.initSession(flow, externalUserId)

      // 2. Open camera (may fail in environments without camera)
      await sdk.openCamera()
      if (videoRef.current) {
        videoRef.current.srcObject = (sdk as any).stream
        await videoRef.current.play().catch(() => {})
      }

      // 3. Capture biometric signals
      const { embedding, liveness: live, antiInjection, commitmentNonce } = await sdk.capture()

      // 4. Verify with backend
      const res = await sdk.verify(
        session.sessionId,
        session.challenge,
        session.backendPubKey,
        embedding,
        live,
        antiInjection,
        commitmentNonce,
        externalUserId,
      )
      setResult(res)
      return res
    } catch (e) {
      const err = e instanceof VeriFaceError ? e : new VeriFaceError('UNKNOWN', String(e))
      setError(err)
      const failResult: VeriFaceResult = {
        success: false,
        sessionId: '',
        status: 'failed',
        liveness: liveness ?? { rppg: 0, rppgHeartRateBpm: null, rppgSnr: 0, padTexture: 0, padDepth: 0, padCombined: 0, overall: 0 },
        antiInjection: null as any,
        commitment: '',
        errorCode: err.code,
        errorMessage: err.message,
      }
      setResult(failResult)
      return failResult
    } finally {
      await sdk.destroy()
    }
  }, [videoRef])

  const authenticate = useCallback((externalUserId?: string) => runFlow('authenticate', externalUserId), [runFlow])
  const enroll = useCallback((externalUserId: string) => runFlow('enroll', externalUserId), [runFlow])

  const cancel = useCallback(() => {
    sdkRef.current?.abort()
  }, [])

  return {
    status,
    liveness,
    rppgProgress,
    error,
    result,
    authenticate,
    enroll,
    cancel,
    videoRef,
  }
}
