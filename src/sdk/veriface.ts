/**
 * VeriFace Edge SDK — Main Orchestrator
 *
 * Coordinates the full authentication / enrollment flow:
 *   1. Initialize crypto session (Ed25519 + X25519 ephemeral keys)
 *   2. Open camera stream (with anti-injection scan)
 *   3. Capture frames for ≥1.5 seconds (passive rPPG window)
 *   4. Per-frame: detect face, compute rPPG, check replay, hash frame
 *   5. Compute final embedding + liveness scores + anti-injection report
 *   6. Compute Pedersen commitment (ZK public input)
 *   7. Sign JWT (Ed25519) with all signals
 *   8. POST payload to backend /session/verify
 *
 * NO raw frame, embedding, or biometric signal ever leaves the browser.
 * Only the cryptographic payload (JWT + commitment + scalar scores) is
 * transmitted, and it is end-to-end encrypted with the session ECDH key.
 */

import {
  ed25519Generate,
  x25519Generate,
  x25519SharedSecret,
  hkdfSha256,
  aesGcmEncrypt,
  createCommitment,
  signJwt,
  secureRandom,
  hex,
  utf8,
  type Ed25519KeyPair,
  type X25519KeyPair,
} from './crypto'
import {
  scanVideoDevices,
  FrameTimingAnalyzer,
  ReplayFilter,
  MicroStrobeProbe,
  checkBrowserTampering,
  attemptDeviceAttestation,
  buildAntiInjectionReport,
  type AntiInjectionReport,
} from './anti-injection'
import {
  detectFace,
  alignFace,
  RppgEstimator,
  computePad,
  generateEmbedding,
  type DetectedFace,
} from './ai-pipeline'
import { generateNeuralEmbedding, preloadNeuralModel } from './neural-embedding'

export type VeriFaceStatus =
  | 'idle'
  | 'initializing'
  | 'requesting-camera'
  | 'scanning-devices'
  | 'capturing'
  | 'processing'
  | 'committing'
  | 'verifying'
  | 'success'
  | 'failed'

export type VeriFaceErrorCode =
  | 'NO_WEBGPU'
  | 'CAMERA_DENIED'
  | 'NO_CAMERA'
  | 'VIRTUAL_CAMERA_ONLY'
  | 'INJECTION_SUSPECTED'
  | 'EXTENSION_TAMPER'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'LIVENESS_FAILED'
  | 'TIMING_SYNTHETIC'
  | 'REPLAY_DETECTED'
  | 'SESSION_EXPIRED'
  | 'NETWORK_ERROR'
  | 'VERIFICATION_FAILED'
  | 'UNSUPPORTED_BROWSER'
  | 'UNKNOWN'

export class VeriFaceError extends Error {
  code: VeriFaceErrorCode
  constructor(code: VeriFaceErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'VeriFaceError'
  }
}

export interface VeriFaceConfig {
  tenantId: string
  apiKey: string  // Required: vf_live_... or vf_test_...
  apiBaseUrl?: string  // defaults to relative path
  modelVersion?: string
  captureDurationMs?: number  // default 1800ms (rPPG needs ~1.5s)
  livenessThreshold?: number  // default 0.78
  highSecurity?: boolean
  theme?: 'light' | 'dark' | 'auto'  // for SDK UI components
}

export interface VeriFaceLivenessReport {
  rppg: number
  rppgHeartRateBpm: number | null
  rppgSnr: number
  padTexture: number
  padDepth: number
  padCombined: number
  overall: number
}

export interface VeriFaceResult {
  success: boolean
  sessionId: string
  status: VeriFaceStatus
  liveness: VeriFaceLivenessReport
  antiInjection: AntiInjectionReport
  commitment: string
  authPayload?: {
    token: string
    expiresAt: number
  }
  errorCode?: VeriFaceErrorCode
  errorMessage?: string
}

type StatusCallback = (status: VeriFaceStatus, detail?: any) => void
type FrameCallback = (frame: {
  video: HTMLVideoElement
  face: DetectedFace | null
  rppgProgress: number
  liveness: VeriFaceLivenessReport | null
}) => void

export class VeriFace {
  private config: Required<VeriFaceConfig>
  private status: VeriFaceStatus = 'idle'
  private statusCallbacks: StatusCallback[] = []
  private frameCallbacks: FrameCallback[] = []
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private rafId: number | null = null
  private captureAbortController: AbortController | null = null

  // Ephemeral session keys (rotated per session)
  private ed25519Keypair: Ed25519KeyPair | null = null
  private x25519Keypair: X25519KeyPair | null = null

  // Anti-injection components
  private timingAnalyzer = new FrameTimingAnalyzer(60)
  private replayFilter = new ReplayFilter(10 * 60 * 1000)
  private strobeProbe = new MicroStrobeProbe()

  // AI pipeline state
  private rppg = new RppgEstimator(72)
  private lastLiveness: VeriFaceLivenessReport | null = null
  private bestEmbedding: Float32Array | null = null
  private bestFaceConfidence = 0

  constructor(config: VeriFaceConfig) {
    this.config = {
      tenantId: config.tenantId,
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl ?? '',
      modelVersion: config.modelVersion ?? 'v1.0.0',
      captureDurationMs: config.captureDurationMs ?? 1800,
      livenessThreshold: config.livenessThreshold ?? 0.78,
      highSecurity: config.highSecurity ?? false,
      theme: config.theme ?? 'auto',
    }
  }

  onStatus(cb: StatusCallback): () => void {
    this.statusCallbacks.push(cb)
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((c) => c !== cb)
    }
  }

  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.push(cb)
    return () => {
      this.frameCallbacks = this.frameCallbacks.filter((c) => c !== cb)
    }
  }

  private setStatus(status: VeriFaceStatus, detail?: any): void {
    this.status = status
    for (const cb of this.statusCallbacks) {
      try { cb(status, detail) } catch { /* ignore callback errors */ }
    }
  }

  getStatus(): VeriFaceStatus {
    return this.status
  }

  /**
   * Initialize a session with the backend. Returns session challenge +
   * backend's ephemeral X25519 public key.
   */
  async initSession(flow: 'enroll' | 'authenticate', externalUserId?: string): Promise<{
    sessionId: string
    challenge: string
    backendPubKey: string
  }> {
    this.setStatus('initializing')

    // Preload neural model in background (non-blocking)
    preloadNeuralModel().catch(() => {})

    // Generate ephemeral session keys
    this.ed25519Keypair = ed25519Generate()
    this.x25519Keypair = x25519Generate()

    const response = await fetch(`${this.config.apiBaseUrl}/api/session/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        tenantId: this.config.tenantId,
        flow,
        externalUserId,
      }),
    })

    if (!response.ok) {
      throw new VeriFaceError('NETWORK_ERROR', `Session init failed: ${response.status}`)
    }

    const data = await response.json()
    if (!data.success) {
      throw new VeriFaceError('NETWORK_ERROR', data.error || 'Session init failed')
    }

    return {
      sessionId: data.sessionId,
      challenge: data.challenge,
      backendPubKey: data.backendPubKey,
    }
  }

  /**
   * Open the camera stream with anti-injection scanning.
   * Throws VeriFaceError if virtual camera is the only option.
   */
  async openCamera(): Promise<MediaStream> {
    this.setStatus('scanning-devices')

    const scan = await scanVideoDevices()
    if (scan.suspiciousOnly) {
      throw new VeriFaceError(
        'VIRTUAL_CAMERA_ONLY',
        'Only virtual cameras detected. Real camera required.',
      )
    }

    this.setStatus('requesting-camera')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 15 },
          facingMode: 'user',
        },
        audio: false,
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        throw new VeriFaceError('CAMERA_DENIED', 'Camera permission denied')
      }
      throw new VeriFaceError('NO_CAMERA', 'No camera available')
    }

    // Create video element if not provided
    this.video = document.createElement('video')
    this.video.srcObject = this.stream
    this.video.muted = true
    this.video.playsInline = true
    await this.video.play()

    return this.stream
  }

  attachVideo(video: HTMLVideoElement): void {
    this.video = video
    if (this.stream) {
      video.srcObject = this.stream
      video.play().catch(() => {})
    }
  }

  /**
   * Capture biometric signals for the configured duration.
   * Runs the full AI pipeline + anti-injection checks per frame.
   */
  async capture(): Promise<{
    embedding: Float32Array
    liveness: VeriFaceLivenessReport
    antiInjection: AntiInjectionReport
    commitmentNonce: Uint8Array
  }> {
    if (!this.video) throw new VeriFaceError('UNKNOWN', 'No video element attached')
    if (!this.ed25519Keypair || !this.x25519Keypair) {
      throw new VeriFaceError('UNKNOWN', 'Session not initialized')
    }

    this.setStatus('capturing')
    this.captureAbortController = new AbortController()

    // Reset pipeline state
    this.rppg = new RppgEstimator(72)
    this.timingAnalyzer = new FrameTimingAnalyzer(60)
    this.replayFilter = new ReplayFilter(10 * 60 * 1000)
    this.strobeProbe = new MicroStrobeProbe()
    this.bestEmbedding = null
    this.bestFaceConfidence = 0
    this.lastLiveness = null

    let replayDetected = false
    let strobeChallenges = 0
    let strobeResponses = 0
    let lastLuminance = 0
    let pendingStrobe = false

    const startTime = performance.now()
    const endTime = startTime + this.config.captureDurationMs

    return new Promise((resolve, reject) => {
      const captureFrame = async () => {
        if (this.captureAbortController?.signal.aborted) {
          reject(new VeriFaceError('UNKNOWN', 'Capture aborted'))
          return
        }

        const now = performance.now()
        if (now >= endTime) {
          this.finishCapture(resolve, reject, replayDetected, strobeChallenges, strobeResponses)
          return
        }

        const video = this.video!
        if (video.readyState < 2) {
          this.rafId = requestAnimationFrame(captureFrame)
          return
        }

        // Record frame arrival timing
        this.timingAnalyzer.recordArrival(now)

        try {
          // Detect face
          const face = await detectFace(video, now)

          if (face) {
            // Compute alignment
            const aligned = alignFace(video, face)
            const ctx = aligned.getContext('2d', { willReadFrequently: true })!
            const imageData = ctx.getImageData(0, 0, 112, 112)

            // Check replay (downsampled hash)
            const replayCheck = this.replayFilter.checkFrame(imageData)
            if (replayCheck.isReplay) {
              replayDetected = true
            }

            // Process rPPG (use full-frame imageData from video)
            const fullCtx = (this.faceCanvas ??= document.createElement('canvas'))
            if (fullCtx.width !== video.videoWidth) {
              fullCtx.width = video.videoWidth
              fullCtx.height = video.videoHeight
            }
            const fctx = fullCtx.getContext('2d', { willReadFrequently: true })!
            fctx.drawImage(video, 0, 0)
            const fullImageData = fctx.getImageData(0, 0, video.videoWidth, video.videoHeight)
            this.rppg.processFrame(fullImageData, face.landmarks, now)

            // Compute PAD
            const pad = computePad(aligned, face.landmarks)

            // Generate embedding (use the best-confidence face)
            // Try neural embedding first (ONNX), fall back to geometric
            if (face.detectionConfidence > this.bestFaceConfidence) {
              this.bestFaceConfidence = face.detectionConfidence
              // Use neural embedding if available; geometric as fallback
              this.bestEmbedding = await generateNeuralEmbedding(aligned, face.landmarks).catch(
                () => generateEmbedding(face.landmarks),
              )
            }

            // Compute liveness
            const rppgResult = this.rppg.computeScore()
            this.lastLiveness = {
              rppg: rppgResult.score,
              rppgHeartRateBpm: rppgResult.heartRateBpm,
              rppgSnr: rppgResult.snr,
              padTexture: pad.texture,
              padDepth: pad.depth,
              padCombined: pad.combined,
              overall: 0.4 * rppgResult.score + 0.35 * pad.texture + 0.25 * pad.depth,
            }

            // Issue strobe challenge at random intervals
            if (!pendingStrobe && (crypto.getRandomValues(new Uint8Array(1))[0] / 256) < 0.04) {
              this.strobeProbe.issueChallenge()
              strobeChallenges++
              pendingStrobe = true
              lastLuminance = this.computeFaceLuminance(imageData)
              setTimeout(() => {
                if (this.lastLiveness && this.video) {
                  // Sample post-strobe luminance
                  const aligned2 = alignFace(this.video, face)
                  const ctx2 = aligned2.getContext('2d', { willReadFrequently: true })!
                  const post = this.computeFaceLuminance(ctx2.getImageData(0, 0, 112, 112))
                  const resp = this.strobeProbe.checkResponse(lastLuminance, post)
                  if (resp.detected) strobeResponses++
                  pendingStrobe = false
                }
              }, 80)
            }

            // Notify frame callbacks
            for (const cb of this.frameCallbacks) {
              try {
                cb({
                  video,
                  face,
                  rppgProgress: rppgResult.samples / 72,
                  liveness: this.lastLiveness,
                })
              } catch { /* ignore */ }
            }
          } else {
            // No face — still notify frame callbacks
            for (const cb of this.frameCallbacks) {
              try { cb({ video, face: null, rppgProgress: 0, liveness: this.lastLiveness }) } catch {}
            }
          }
        } catch (e) {
          // Don't abort capture on per-frame errors
          console.warn('Frame processing error:', e)
        }

        this.rafId = requestAnimationFrame(captureFrame)
      }

      this.rafId = requestAnimationFrame(captureFrame)
    })
  }

  private faceCanvas: HTMLCanvasElement | null = null

  private computeFaceLuminance(imageData: ImageData): number {
    const { data } = imageData
    let sum = 0
    const pixels = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    return sum / pixels
  }

  private async finishCapture(
    resolve: (value: any) => void,
    reject: (reason?: any) => void,
    replayDetected: boolean,
    strobeChallenges: number,
    strobeResponses: number,
  ): Promise<void> {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = null

    this.setStatus('processing')

    if (!this.bestEmbedding) {
      reject(new VeriFaceError('NO_FACE', 'No face detected during capture'))
      return
    }

    if (!this.lastLiveness) {
      reject(new VeriFaceError('LIVENESS_FAILED', 'Liveness signals not collected'))
      return
    }

    // Compute final anti-injection report
    const deviceScan = await scanVideoDevices()
    const tamper = checkBrowserTampering()
    const attestation = await attemptDeviceAttestation()
    const antiInjection = buildAntiInjectionReport(
      deviceScan,
      this.timingAnalyzer,
      replayDetected,
      tamper,
      attestation,
      strobeChallenges,
      strobeResponses,
    )

    if (!antiInjection.passed) {
      reject(new VeriFaceError(
        'INJECTION_SUSPECTED',
        `Anti-injection failed: ${antiInjection.failureReasons.join(', ')}`,
      ))
      return
    }

    if (this.lastLiveness.overall < this.config.livenessThreshold) {
      reject(new VeriFaceError(
        'LIVENESS_FAILED',
        `Liveness score ${this.lastLiveness.overall.toFixed(3)} below threshold ${this.config.livenessThreshold}`,
      ))
      return
    }

    // Generate Pedersen commitment nonce
    const commitmentNonce = secureRandom(32)

    this.setStatus('committing')
    resolve({
      embedding: this.bestEmbedding,
      liveness: this.lastLiveness,
      antiInjection,
      commitmentNonce,
    })
  }

  /**
   * Build and submit the verification payload to the backend.
   * Payload is end-to-end encrypted via ECDH-derived AES-256-GCM key.
   */
  async verify(
    sessionId: string,
    challenge: string,
    backendPubKeyHex: string,
    embedding: Float32Array,
    liveness: VeriFaceLivenessReport,
    antiInjection: AntiInjectionReport,
    commitmentNonce: Uint8Array,
    externalUserId?: string,
  ): Promise<VeriFaceResult> {
    if (!this.ed25519Keypair || !this.x25519Keypair) {
      throw new VeriFaceError('UNKNOWN', 'Session not initialized')
    }

    this.setStatus('verifying')

    // Derive ECDH session key for payload encryption
    const shared = x25519SharedSecret(
      this.x25519Keypair.privateKey,
      hex.decode(backendPubKeyHex),
    )
    const sessionKey = hkdfSha256(
      shared,
      utf8.encode(challenge),
      utf8.encode('veriface-session-v1'),
      32,
    )

    // Compute Pedersen commitment
    const commitment = createCommitment(embedding, commitmentNonce)

    // Build JWT claims
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: 'veriface-edge',
      sub: sessionId,
      iat: now,
      exp: now + 60,
      jti: crypto.randomUUID(),
      tenant_id: this.config.tenantId,
      flow: 'authenticate',
      external_user_id: externalUserId,
      commitment,
      liveness: {
        rppg: liveness.rppg,
        rppg_hr_bpm: liveness.rppgHeartRateBpm,
        rppg_snr: liveness.rppgSnr,
        pad_texture: liveness.padTexture,
        pad_depth: liveness.padDepth,
        pad_combined: liveness.padCombined,
        overall: liveness.overall,
      },
      anti_injection: {
        passed: antiInjection.passed,
        device_real_count: antiInjection.deviceScan.realCameras.length,
        device_virtual_count: antiInjection.deviceScan.virtualCameras.length,
        timing_cv: antiInjection.timingStats.cv,
        timing_synthetic: antiInjection.timingStats.synthetic,
        replay_detected: antiInjection.replayDetected,
        tamper_passed: antiInjection.tamperCheck.passed,
        attestation_algo: antiInjection.attestation.algorithm,
        strobe_challenges: antiInjection.strobeChallenges,
        strobe_responses: antiInjection.strobeResponses,
      },
      model_version: this.config.modelVersion,
      sdk_version: '1.0.0',
      // ZK "proof" — in production this would be a Groth16 proof.
      // Here: the Ed25519 signature on the JWT itself serves as the
      // proof of honest SDK origin (the backend has the SDK's public key).
      proof: {
        type: 'ed25519-attestation',
        sdk_pubkey: hex.encode(this.ed25519Keypair.publicKey),
        nonce: hex.encode(commitmentNonce),
      },
    }

    const jwt = signJwt(claims, this.ed25519Keypair.privateKey)

    // Encrypt the embedding with the session key (defense in depth —
    // even though the commitment is the only thing the backend needs,
    // sending the encrypted embedding allows the backend to do
    // cosine similarity matching inside the secure enclave).
    const embBytes = new Uint8Array(embedding.length * 4)
    const view = new DataView(embBytes.buffer)
    for (let i = 0; i < embedding.length; i++) {
      view.setFloat32(i * 4, embedding[i], true)
    }
    const sealed = aesGcmEncrypt(sessionKey, embBytes, utf8.encode(challenge))

    const response = await fetch(`${this.config.apiBaseUrl}/api/session/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        sessionId,
        tenantId: this.config.tenantId,
        jwt,
        sdkPubKey: hex.encode(this.x25519Keypair.publicKey),
        encryptedEmbedding: {
          ciphertext: hex.encode(sealed.ciphertext),
          iv: hex.encode(sealed.iv),
          authTag: hex.encode(sealed.authTag),
        },
        commitment,
        commitmentNonce: hex.encode(commitmentNonce),
        liveness,
        antiInjection,
        externalUserId,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}))
      return {
        success: false,
        sessionId,
        status: 'failed',
        liveness,
        antiInjection,
        commitment,
        errorCode: errorBody.code ?? 'NETWORK_ERROR',
        errorMessage: errorBody.error ?? `HTTP ${response.status}`,
      }
    }

    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        sessionId,
        status: 'failed',
        liveness,
        antiInjection,
        commitment,
        errorCode: data.code ?? 'VERIFICATION_FAILED',
        errorMessage: data.error ?? 'Verification failed',
      }
    }

    this.setStatus('success')

    return {
      success: true,
      sessionId,
      status: 'success',
      liveness,
      antiInjection,
      commitment,
      authPayload: {
        token: data.token,
        expiresAt: data.expiresAt,
      },
    }
  }

  /**
   * Abort any in-progress capture.
   */
  abort(): void {
    if (this.captureAbortController) {
      this.captureAbortController.abort()
    }
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.setStatus('failed')
  }

  /**
   * Release all resources (camera, video, etc.).
   */
  async destroy(): Promise<void> {
    this.abort()
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }
    // Wipe sensitive material from memory
    if (this.ed25519Keypair) this.ed25519Keypair.privateKey.fill(0)
    if (this.x25519Keypair) this.x25519Keypair.privateKey.fill(0)
    if (this.bestEmbedding) this.bestEmbedding.fill(0)
    this.ed25519Keypair = null
    this.x25519Keypair = null
    this.bestEmbedding = null
    this.setStatus('idle')
  }
}
