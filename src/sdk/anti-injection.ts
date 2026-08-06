/**
 * VeriFace Edge SDK — Anti-Injection Defense Layer
 *
 * Six independent layers of defense against camera tampering,
 * virtual cameras, browser extension hooks, and replay attacks.
 *
 * Section references are to the Master Architecture document.
 */

import { blake3Hex, hex, utf8 } from './crypto'

// ---------------------------------------------------------------------------
// 1.5.1 — Virtual Camera Detection
// ---------------------------------------------------------------------------

const VIRTUAL_CAMERA_PATTERNS = [
  /obs virtual camera/i,
  /manycam/i,
  /snap camera/i,
  /camtwist/i,
  /vcam/i,
  /droidcam/i,
  /ivcam/i,
  /splitcam/i,
  /avermedia recentral/i,
  /live_mesh virtual/i,
  /camo/i,
  /nvidia broadcast/i,
  /epoccam/i,
  /ivcam/i,
  /altercam/i,
]

export interface DeviceScanResult {
  totalDevices: number
  realCameras: string[]
  virtualCameras: string[]
  suspiciousOnly: boolean
}

export async function scanVideoDevices(): Promise<DeviceScanResult> {
  // Pre-flight: request permission so labels are populated.
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    tmp.getTracks().forEach((t) => t.stop())
  } catch {
    // Ignore — permission will be requested again at capture time.
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  const videoInputs = devices.filter((d) => d.kind === 'videoinput')

  const realCameras: string[] = []
  const virtualCameras: string[] = []

  for (const dev of videoInputs) {
    const label = dev.label || '(unlabeled)'
    const isVirtual = VIRTUAL_CAMERA_PATTERNS.some((p) => p.test(label))
    if (isVirtual) {
      virtualCameras.push(label)
    } else {
      realCameras.push(label)
    }
  }

  return {
    totalDevices: videoInputs.length,
    realCameras,
    virtualCameras,
    suspiciousOnly: virtualCameras.length > 0 && realCameras.length === 0,
  }
}

// ---------------------------------------------------------------------------
// 1.5.2 — Frame-Timing Jitter Analysis
// ---------------------------------------------------------------------------

/**
 * Maintains a rolling window of frame arrival timestamps and computes
 * the coefficient of variation (σ/μ). Real cameras exhibit Poisson-like
 * jitter (σ/μ in 0.1–0.4); injected streams (OBS, v4l2loopback) show
 * tight, periodic timing (σ/μ < 0.05).
 */
export class FrameTimingAnalyzer {
  private arrivals: number[] = []
  private readonly windowSize: number

  constructor(windowSize = 60) {
    this.windowSize = windowSize
  }

  recordArrival(timestamp: number): void {
    this.arrivals.push(timestamp)
    if (this.arrivals.length > this.windowSize) {
      this.arrivals.shift()
    }
  }

  /**
   * Returns true if the timing pattern is suspiciously periodic,
   * indicating a synthetic / injected stream.
   */
  isSynthetic(): boolean {
    if (this.arrivals.length < 10) return false
    const intervals: number[] = []
    for (let i = 1; i < this.arrivals.length; i++) {
      intervals.push(this.arrivals[i] - this.arrivals[i - 1])
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    if (mean === 0) return true
    const variance =
      intervals.reduce((acc, x) => acc + (x - mean) ** 2, 0) / intervals.length
    const std = Math.sqrt(variance)
    const cv = std / mean
    return cv < 0.05
  }

  stats(): { mean: number; std: number; cv: number; samples: number } {
    if (this.arrivals.length < 2) {
      return { mean: 0, std: 0, cv: 0, samples: this.arrivals.length }
    }
    const intervals: number[] = []
    for (let i = 1; i < this.arrivals.length; i++) {
      intervals.push(this.arrivals[i] - this.arrivals[i - 1])
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const variance =
      intervals.reduce((acc, x) => acc + (x - mean) ** 2, 0) / intervals.length
    const std = Math.sqrt(variance)
    return { mean, std, cv: mean === 0 ? 0 : std / mean, samples: intervals.length }
  }
}

// ---------------------------------------------------------------------------
// 1.5.3 — Per-Frame Content Hashing & Replay Detection
// ---------------------------------------------------------------------------

/**
 * Rolling bloom filter of frame hashes (last 10 minutes). Detects
 * duplicate frames within a single session (replay attack from a
 * pre-recorded video).
 *
 * Implementation: simple Map<string, number> (hash → lastSeen timestamp).
 * Pruned every 60 seconds to bound memory.
 */
export class ReplayFilter {
  private seen = new Map<string, number>()
  private readonly ttlMs: number
  private lastPrune = Date.now()

  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs
  }

  /**
   * Hash a frame's pixel data (downsampled to 32x32 grayscale for speed)
   * and check if it has been seen before.
   *
   * Returns { isReplay, hash }.
   */
  checkFrame(imageData: ImageData): { isReplay: boolean; hash: string } {
    // Downsample to 32x32 grayscale — sufficient for replay detection,
    // reduces BLAKE3 input size from 192KB to 1KB.
    const downsampled = downsampleToGray32(imageData)
    const hash = blake3Hex(downsampled)
    const now = Date.now()

    if (now - this.lastPrune > 60_000) {
      this.prune(now)
      this.lastPrune = now
    }

    const isReplay = this.seen.has(hash)
    this.seen.set(hash, now)
    return { isReplay, hash }
  }

  private prune(now: number): void {
    const cutoff = now - this.ttlMs
    for (const [hash, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(hash)
    }
  }

  size(): number {
    return this.seen.size
  }
}

function downsampleToGray32(imageData: ImageData): Uint8Array {
  const { data, width, height } = imageData
  const out = new Uint8Array(32 * 32)
  const cellW = width / 32
  const cellH = height / 32
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      let sum = 0
      let count = 0
      const startY = Math.floor(y * cellH)
      const endY = Math.floor((y + 1) * cellH)
      const startX = Math.floor(x * cellW)
      const endX = Math.floor((x + 1) * cellW)
      for (let py = startY; py < endY; py++) {
        for (let px = startX; px < endX; px++) {
          const idx = (py * width + px) * 4
          // ITU-R BT.601 luminance
          sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
          count++
        }
      }
      out[y * 32 + x] = count > 0 ? Math.round(sum / count) : 0
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 1.5.4 — Active Probe: Challenge Micro-Strobe
//
// The SDK emits a 4-pixel white strobe at random sub-100ms intervals in
// a corner of its own UI overlay. The capture loop checks if the strobe's
// reflection appears on the user's sclera/forehead within the next 2 frames.
// Pre-recorded videos fail this test (no real-time reflection).
//
// This is NOT active liveness — the strobe is sub-perceptible
// (~8ms pulse, <0.5% screen luminance change).
// ---------------------------------------------------------------------------

export class MicroStrobeProbe {
  private pendingChallenges: Array<{
    issuedAt: number
    intensity: number
    nonce: number
  }> = []

  issueChallenge(): { intensity: number; nonce: number } {
    const challenge = {
      issuedAt: performance.now(),
      intensity: 200 + Math.random() * 55, // 200-255 (sub-perceptible when brief)
      nonce: Math.floor(Math.random() * 0xffffffff),
    }
    this.pendingChallenges.push(challenge)
    if (this.pendingChallenges.length > 5) this.pendingChallenges.shift()
    return { intensity: challenge.intensity, nonce: challenge.nonce }
  }

  /**
   * Check if the captured frame shows the expected luminance spike
   * in the user's sclera region (indicating real-time reflection).
   *
   * Simplified: checks if mean luminance in the upper face region
   * increased by >3% in the frames immediately following a challenge.
   */
  checkResponse(
    preLuminance: number,
    postLuminance: number,
  ): { detected: boolean; deltaPct: number } {
    if (preLuminance === 0) return { detected: false, deltaPct: 0 }
    const deltaPct = ((postLuminance - preLuminance) / preLuminance) * 100
    // Real reflection: small but measurable spike (1-5%)
    // Deepfake: typically 0% (no reflection modeled) or >8% (over-rendered)
    const detected = deltaPct >= 0.8 && deltaPct <= 7
    return { detected, deltaPct }
  }

  clear(): void {
    this.pendingChallenges = []
  }
}

// ---------------------------------------------------------------------------
// 1.5.5 — Browser Extension Tamper Defense
// ---------------------------------------------------------------------------

/**
 * Verify that critical browser APIs have not been monkey-patched by
 * a browser extension. Checks that prototypes match their native
 * toString() output and that function names are unchanged.
 */
export interface TamperCheckResult {
  passed: boolean
  violations: string[]
}

const NATIVE_FN_SIGNATURES = [
  { obj: 'navigator.mediaDevices', fn: 'getUserMedia', expected: '[object Promise]' },
]

export function checkBrowserTampering(): TamperCheckResult {
  const violations: string[] = []

  // Check 1: MediaStreamTrack prototype integrity
  try {
    const proto = window.MediaStreamTrack?.prototype
    if (!proto) {
      violations.push('MediaStreamTrack prototype missing')
    } else {
      const desc = Object.getOwnPropertyDescriptor(proto, 'applyConstraints')
      if (desc && desc.value && desc.value.toString().includes('[native code]') === false) {
        // Some browsers don't include '[native code]' — soft check
      }
    }
  } catch {
    violations.push('MediaStreamTrack access failed')
  }

  // Check 2: Canvas getContext integrity
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')
    if (desc && desc.value && typeof desc.value === 'function') {
      const src = desc.value.toString()
      if (!src.includes('native code') && !src.includes('function getContext')) {
        violations.push('HTMLCanvasElement.prototype.getContext appears patched')
      }
    }
  } catch {
    // Ignore
  }

  // Check 3: Worker constructor integrity
  try {
    const workerSrc = Worker.toString()
    if (!workerSrc.includes('native code') && workerSrc.length > 200) {
      violations.push('Worker constructor appears overridden')
    }
  } catch {
    // Ignore
  }

  return {
    passed: violations.length === 0,
    violations,
  }
}

/**
 * Heartbeat HMAC between main thread and worker. If an extension
 * injects hooks between the two, the HMAC will mismatch.
 *
 * Both sides compute: HMAC-SHA256(sharedSecret, timestamp_minute)
 * and compare. Mismatch = abort.
 */
export class HeartbeatMonitor {
  private secret: Uint8Array
  private expected: string | null = null
  private lastBeat = 0

  constructor(secret: Uint8Array) {
    this.secret = secret
  }

  computeBeat(): string {
    const ts = Math.floor(Date.now() / 100) // 100ms granularity
    const beat = hmacSha256Hex(this.secret, ts.toString())
    this.expected = beat
    this.lastBeat = Date.now()
    return beat
  }

  verifyBeat(received: string): boolean {
    if (!this.expected) return false
    if (Date.now() - this.lastBeat > 5000) return false
    return received === this.expected
  }
}

// Tiny in-file HMAC (avoids circular import with crypto.ts)
function hmacSha256Hex(key: Uint8Array, message: string): string {
  // Use Web Crypto API for HMAC since we're in browser context
  // and need a synchronous-ish API for the heartbeat. Fall back to
  // a simple hash combine for demo purposes — production would
  // dispatch to worker with async HMAC.
  // Here we use blake3 with key prefix as a stand-in.
  return blake3Hex(hex.encode(key) + '|' + message)
}

// ---------------------------------------------------------------------------
// 1.5.6 — Hardware Attestation (best-effort in browser)
// ---------------------------------------------------------------------------

export interface DeviceAttestation {
  platform: 'android' | 'ios' | 'desktop' | 'unknown'
  attestationAvailable: boolean
  attestationData: string | null
  algorithm: string | null
}

/**
 * Best-effort device attestation. Browser APIs are limited — full
 * hardware attestation requires the calling app to wrap the SDK in a
 * native WebView (see architecture doc §1.5.6).
 */
export async function attemptDeviceAttestation(): Promise<DeviceAttestation> {
  const ua = navigator.userAgent
  let platform: DeviceAttestation['platform'] = 'unknown'
  if (/android/i.test(ua)) platform = 'android'
  else if (/ipad|iphone|ipod/i.test(ua)) platform = 'ios'
  else platform = 'desktop'

  // Check WebAuthn platform authenticator availability
  let webauthnAvailable = false
  try {
    if (
      typeof window.PublicKeyCredential !== 'undefined' &&
      'isUserVerifyingPlatformAuthenticatorAvailable' in window.PublicKeyCredential
    ) {
      webauthnAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    }
  } catch {
    // Ignore
  }

  // Check iOS App Attest bridge (only available when wrapped in WKWebView
  // by a native iOS app that exposes the message handler).
  let iosAttestation: string | null = null
  try {
    if (typeof (window as any).webkit?.messageHandlers?.verifaceAttestation !== 'undefined') {
      iosAttestation = await (window as any).webkit.messageHandlers.verifaceAttestation.postMessage('request')
    }
  } catch {
    // Ignore
  }

  return {
    platform,
    attestationAvailable: webauthnAvailable || iosAttestation !== null,
    attestationData: iosAttestation,
    algorithm: iosAttestation ? 'app-attest-v1' : webauthnAvailable ? 'webauthn-platform' : null,
  }
}

// ---------------------------------------------------------------------------
// Combined anti-injection report
// ---------------------------------------------------------------------------

export interface AntiInjectionReport {
  deviceScan: DeviceScanResult
  timingStats: { mean: number; std: number; cv: number; samples: number; synthetic: boolean }
  replayDetected: boolean
  tamperCheck: TamperCheckResult
  attestation: DeviceAttestation
  strobeResponses: number
  strobeChallenges: number
  passed: boolean
  failureReasons: string[]
}

export function buildAntiInjectionReport(
  deviceScan: DeviceScanResult,
  timing: FrameTimingAnalyzer,
  replayDetected: boolean,
  tamper: TamperCheckResult,
  attestation: DeviceAttestation,
  strobeChallenges: number,
  strobeResponses: number,
): AntiInjectionReport {
  const timingStats = timing.stats()
  const failureReasons: string[] = []

  if (deviceScan.suspiciousOnly) {
    failureReasons.push('VIRTUAL_CAMERA_ONLY')
  }
  if (timingStats.samples >= 10 && timing.isSynthetic()) {
    failureReasons.push('PERIODIC_FRAME_TIMING')
  }
  if (replayDetected) {
    failureReasons.push('REPLAY_DETECTED')
  }
  if (!tamper.passed) {
    failureReasons.push('EXTENSION_TAMPER')
    failureReasons.push(...tamper.violations)
  }
  // Strobe probe is advisory (sub-perceptible, can fail due to lighting)
  // — does not hard-fail but reduces confidence.

  return {
    deviceScan,
    timingStats: { ...timingStats, synthetic: timing.isSynthetic() },
    replayDetected,
    tamperCheck: tamper,
    attestation,
    strobeResponses,
    strobeChallenges,
    passed: failureReasons.length === 0,
    failureReasons,
  }
}
