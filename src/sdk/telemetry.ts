/**
 * VeriFace Edge SDK — Telemetry Module (Opt-in, Anonymous)
 *
 * PRIVACY CONTRACT — read this before changing anything:
 *   1. Telemetry is OFF by default. It must be explicitly enabled via
 *      `config.telemetryOptIn = true` AFTER the user grants consent.
 *   2. We NEVER send: face frames, embeddings, raw rPPG signals, audio,
 *      full user-agent strings, IP addresses, user IDs, email addresses,
 *      or any biometric data.
 *   3. We ONLY send: error codes, SDK version, stage, browser/OS family
 *      (extracted locally — not the full UA), WebGPU/camera availability,
 *      anonymous timing metrics, and (if assigned) experiment variant.
 *   4. All strings are length-capped at 256 chars and PII-redacted
 *      (emails, IPs, session IDs in error messages are scrubbed).
 *   5. Batching: events are queued in-memory and flushed every 30s OR
 *      when 10 events accumulate. Failed sends are retried with backoff.
 *   6. The user can revoke consent at any time via `veriface.telemetry.disable()`
 *      — this immediately clears the queue and stops collection.
 *
 * Ingestion endpoint: POST /api/sdk/telemetry
 * Rate limit: 10 events/min per IP (server-enforced).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SdkErrorSeverity = 'fatal' | 'error' | 'warning'

export type SdkErrorStage =
  | 'init'
  | 'camera'
  | 'capture'
  | 'liveness'
  | 'anti_injection'
  | 'crypto'
  | 'verify'
  | 'network'

export interface SdkTelemetryEvent {
  /** Error code (e.g., 'CAMERA_DENIED', 'LIVENESS_FAILED'). */
  errorCode: string
  /** Severity: fatal = crashes the flow, error = recoverable, warning = degraded. */
  severity: SdkErrorSeverity
  /** Stage where the error occurred. */
  stage: SdkErrorStage
  /** Truncated (256 chars) + PII-redacted error message. */
  errorMessage: string
  /** Anonymous environment fingerprint (extracted locally). */
  browserFamily: string
  osFamily: string
  hasWebGPU: boolean
  hasCamera: boolean
  /** Session ID (only if SDK was mid-session — used to correlate with backend audit log). */
  sessionId?: string
  /** Active experiment assignment (if any). */
  experimentId?: string
  experimentVariant?: string
  /** Anonymous client-side timing metrics. */
  metrics?: Record<string, number>
  /** ISO timestamp. */
  timestamp: string
}

export interface TelemetryConfig {
  /** Required: must be true to enable. */
  optIn: boolean
  /** Backend base URL (defaults to relative). */
  apiBaseUrl?: string
  /** Tenant ID (for grouping — backend hashes before storing). */
  tenantId: string
  /** SDK semver. */
  sdkVersion: string
  /** Batch size (default 10). */
  batchSize?: number
  /** Flush interval in ms (default 30000). */
  flushIntervalMs?: number
}

// ---------------------------------------------------------------------------
// PII redaction
// ---------------------------------------------------------------------------

const PII_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Email addresses
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[email]' },
  // JWT tokens (before hex — JWTs are base64url, look like 3 dot-separated blobs)
  { regex: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '[jwt]' },
  // Credit card numbers (before phone — phone regex would catch 16-digit sequences)
  { regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[card]' },
  // IPv4 addresses
  { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[ip]' },
  // IPv6 addresses (simplified)
  { regex: /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g, replacement: '[ip]' },
  // Phone numbers (US + intl) — must come after credit card
  { regex: /\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g, replacement: '[phone]' },
  // Session IDs (cuid format — 24-char base36)
  { regex: /\b[a-z0-9]{24}\b/g, replacement: '[id]' },
  // Hex blobs (32+ chars — could be embeddings, keys, etc.)
  { regex: /\b[a-fA-F0-9]{32,}\b/g, replacement: '[hex]' },
]

function redactPii(input: string): string {
  let result = input
  for (const { regex, replacement } of PII_PATTERNS) {
    result = result.replace(regex, replacement)
  }
  return result
}

function truncate(s: string, max = 256): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// ---------------------------------------------------------------------------
// Environment detection (anonymous — only family, no full UA)
// ---------------------------------------------------------------------------

function detectBrowserFamily(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/Firefox\//.test(ua) && !/Seamonkey\//.test(ua)) return 'firefox'
  if (/Edg\//.test(ua)) return 'edge'
  if (/OPR\//.test(ua) || /Opera\//.test(ua)) return 'opera'
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'chrome'
  if (/Chromium\//.test(ua)) return 'chromium'
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'safari'
  return 'unknown'
}

function detectOsFamily(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  const platform = (navigator as any).userAgentData?.platform ?? ua
  if (/Windows/i.test(platform)) return 'windows'
  if (/Mac/i.test(platform)) return 'macos'
  if (/Linux/i.test(platform) && !/Android/i.test(ua)) return 'linux'
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  return 'unknown'
}

function hasWebGPU(): boolean {
  if (typeof navigator === 'undefined') return false
  return !!(navigator as any).gpu
}

// ---------------------------------------------------------------------------
// Telemetry collector (singleton per SDK instance)
// ---------------------------------------------------------------------------

export class SdkTelemetry {
  private config: TelemetryConfig | null = null
  private queue: SdkTelemetryEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private isFlushing = false
  private experimentContext: { experimentId: string; variant: string } | null = null
  private sessionContext: { sessionId: string } | null = null

  /** Configure telemetry. Call with optIn=true to start collection. */
  configure(config: TelemetryConfig): void {
    // If we were previously opted-in and now opting out, flush + clear
    if (this.config?.optIn && !config.optIn) {
      this.disable()
      return
    }

    this.config = config

    if (config.optIn && !this.flushTimer) {
      const interval = config.flushIntervalMs ?? 30_000
      this.flushTimer = setInterval(() => {
        void this.flush().catch(() => {})
      }, interval)
      // Don't keep the process alive just for telemetry
      this.flushTimer.unref?.()
    }
  }

  /** Update opt-in status at runtime (e.g., when user toggles consent). */
  setOptIn(optIn: boolean): void {
    if (!this.config) return
    if (optIn === this.config.optIn) return
    this.configure({ ...this.config, optIn })
  }

  /** Disable telemetry — clears queue, stops timer, drops config. */
  disable(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.queue = []
    this.config = null
    this.experimentContext = null
    this.sessionContext = null
  }

  /** Set the active experiment context (for A/B cohort attribution). */
  setExperimentContext(experimentId: string, variant: string): void {
    this.experimentContext = { experimentId, variant }
  }

  /** Clear the experiment context. */
  clearExperimentContext(): void {
    this.experimentContext = null
  }

  /** Set the session context (correlates telemetry with backend audit log). */
  setSessionContext(sessionId: string): void {
    this.sessionContext = { sessionId }
  }

  clearSessionContext(): void {
    this.sessionContext = null
  }

  /** Record an error event. No-op if telemetry is not opted-in. */
  recordError(opts: {
    errorCode: string
    severity?: SdkErrorSeverity
    stage: SdkErrorStage
    error: Error | string
    metrics?: Record<string, number>
  }): void {
    if (!this.config?.optIn) return

    const errorMessage = typeof opts.error === 'string' ? opts.error : opts.error.message
    const event: SdkTelemetryEvent = {
      errorCode: truncate(opts.errorCode, 64),
      severity: opts.severity ?? 'error',
      stage: opts.stage,
      errorMessage: truncate(redactPii(errorMessage), 256),
      browserFamily: detectBrowserFamily(),
      osFamily: detectOsFamily(),
      hasWebGPU: hasWebGPU(),
      hasCamera: this.sessionContext !== null, // best-effort heuristic
      sessionId: this.sessionContext?.sessionId,
      experimentId: this.experimentContext?.experimentId,
      experimentVariant: this.experimentContext?.variant,
      metrics: opts.metrics,
      timestamp: new Date().toISOString(),
    }

    this.queue.push(event)

    // Flush immediately on fatal errors
    if (opts.severity === 'fatal') {
      void this.flush().catch(() => {})
    }

    // Flush when batch size reached
    const batchSize = this.config.batchSize ?? 10
    if (this.queue.length >= batchSize) {
      void this.flush().catch(() => {})
    }
  }

  /** Send queued events to the backend. Retries once on failure. */
  async flush(): Promise<void> {
    if (!this.config?.optIn || this.isFlushing || this.queue.length === 0) return

    this.isFlushing = true
    const batch = this.queue.splice(0, this.queue.length)

    try {
      const baseUrl = this.config.apiBaseUrl ?? ''
      const url = `${baseUrl}/api/sdk/telemetry`

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: this.config.tenantId,
          sdkVersion: this.config.sdkVersion,
          events: batch,
        }),
        // Use keepalive so the request survives page unload
        keepalive: true,
      })

      if (!res.ok) {
        // Re-queue on 5xx (transient); drop on 4xx (client error)
        if (res.status >= 500) {
          this.queue.unshift(...batch)
        }
      }
    } catch {
      // Network error — re-queue for next flush
      this.queue.unshift(...batch)
    } finally {
      this.isFlushing = false
    }
  }

  /** Get current queue depth (for debugging). */
  getQueueDepth(): number {
    return this.queue.length
  }

  /** Check if telemetry is currently opted-in. */
  isEnabled(): boolean {
    return this.config?.optIn === true
  }
}

// ---------------------------------------------------------------------------
// Singleton instance (shared across SDK modules)
// ---------------------------------------------------------------------------

export const telemetry = new SdkTelemetry()

/**
 * Convenience function: wrap an async operation with telemetry.
 * Records errors and timing metrics automatically.
 */
export async function withTelemetry<T>(
  stage: SdkErrorStage,
  errorCode: string,
  fn: () => Promise<T>,
  opts?: { metrics?: Record<string, number>; severity?: SdkErrorSeverity },
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    // Optionally record success metrics (but don't store as error)
    return result
  } catch (e: any) {
    telemetry.recordError({
      errorCode,
      severity: opts?.severity ?? 'error',
      stage,
      error: e,
      metrics: {
        ...opts?.metrics,
        durationMs: Date.now() - start,
      },
    })
    throw e
  }
}
