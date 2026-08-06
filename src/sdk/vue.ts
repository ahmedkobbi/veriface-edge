/**
 * VeriFace Edge SDK — Vue 3 Composable
 *
 * Drop-in Vue 3 integration for the VeriFace SDK.
 *
 * Usage:
 *   <script setup lang="ts">
 *   import { useFaceAuth } from '@veriface/vue'
 *
 *   const { status, liveness, error, authenticate, videoRef } = useFaceAuth({
 *     tenantId: 'tnt_...',
 *     apiKey: 'vf_live_...',
 *   })
 *   </script>
 *
 *   <template>
 *     <video ref="videoRef" autoplay playsinline muted />
 *     <button @click="authenticate('user_123')" :disabled="status === 'capturing'">
 *       Sign in with Face
 *     </button>
 *   </template>
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { VeriFace, VeriFaceError } from './veriface'
import type { VeriFaceConfig, VeriFaceStatus, VeriFaceLivenessReport, VeriFaceResult } from './veriface'

export interface UseFaceAuthOptions extends VeriFaceConfig {
  videoRef?: Ref<HTMLVideoElement | null>
  onStatus?: (status: VeriFaceStatus) => void
  onFrame?: (frame: { rppgProgress: number; liveness: VeriFaceLivenessReport | null }) => void
}

export interface UseFaceAuthReturn {
  status: Ref<VeriFaceStatus>
  liveness: Ref<VeriFaceLivenessReport | null>
  rppgProgress: Ref<number>
  error: Ref<VeriFaceError | null>
  result: Ref<VeriFaceResult | null>
  authenticate: (externalUserId?: string) => Promise<VeriFaceResult>
  enroll: (externalUserId: string) => Promise<VeriFaceResult>
  cancel: () => void
  videoRef: Ref<HTMLVideoElement | null>
}

export function useFaceAuth(options: UseFaceAuthOptions): UseFaceAuthReturn {
  const status = ref<VeriFaceStatus>('idle')
  const liveness = ref<VeriFaceLivenessReport | null>(null)
  const rppgProgress = ref(0)
  const error = ref<VeriFaceError | null>(null)
  const result = ref<VeriFaceResult | null>(null)

  let sdk: VeriFace | null = null
  const videoRef = options.videoRef ?? ref<HTMLVideoElement | null>(null)

  onMounted(() => {
    if (!options.tenantId || !options.apiKey) return
    sdk = new VeriFace({
      tenantId: options.tenantId,
      apiKey: options.apiKey,
      apiBaseUrl: options.apiBaseUrl,
      modelVersion: options.modelVersion,
      captureDurationMs: options.captureDurationMs,
      livenessThreshold: options.livenessThreshold,
      highSecurity: options.highSecurity,
      theme: options.theme,
    })

    sdk.onStatus((s) => {
      status.value = s
      options.onStatus?.(s)
    })
    sdk.onFrame((frame) => {
      liveness.value = frame.liveness
      rppgProgress.value = frame.rppgProgress
      options.onFrame?.({ rppgProgress: frame.rppgProgress, liveness: frame.liveness })
    })
  })

  onUnmounted(() => {
    sdk?.destroy()
    sdk = null
  })

  const runFlow = async (
    flow: 'enroll' | 'authenticate',
    externalUserId?: string,
  ): Promise<VeriFaceResult> => {
    if (!sdk) throw new Error('SDK not initialized')

    error.value = null
    result.value = null
    liveness.value = null
    rppgProgress.value = 0

    try {
      const session = await sdk.initSession(flow, externalUserId)
      await sdk.openCamera()
      if (videoRef.value) {
        videoRef.value.srcObject = (sdk as any).stream
        await videoRef.value.play().catch(() => {})
      }
      const { embedding, liveness: live, antiInjection, commitmentNonce } = await sdk.capture()
      const res = await sdk.verify(
        session.sessionId, session.challenge, session.backendPubKey,
        embedding, live, antiInjection, commitmentNonce, externalUserId,
      )
      result.value = res
      return res
    } catch (e) {
      const err = e instanceof VeriFaceError ? e : new VeriFaceError('UNKNOWN', String(e))
      error.value = err
      const failResult: any = {
        success: false,
        sessionId: '',
        status: 'failed',
        liveness: liveness.value ?? { rppg: 0, rppgHeartRateBpm: null, rppgSnr: 0, padTexture: 0, padDepth: 0, padCombined: 0, overall: 0 },
        antiInjection: null,
        commitment: '',
        errorCode: err.code,
        errorMessage: err.message,
      }
      result.value = failResult
      return failResult
    } finally {
      await sdk.destroy()
    }
  }

  const authenticate = (externalUserId?: string) => runFlow('authenticate', externalUserId)
  const enroll = (externalUserId: string) => runFlow('enroll', externalUserId)
  const cancel = () => sdk?.abort()

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
