/**
 * VeriFace Edge SDK — Web Component (`<face-auth>`)
 *
 * Drop-in HTML element for facial authentication. No framework required.
 *
 * Usage:
 *   <script type="module" src="https://cdn.veriface.io/v1/face-auth.js"></script>
 *   <face-auth
 *     tenant-id="tnt_..."
 *     api-key="vf_live_..."
 *     flow="authenticate"
 *     external-user-id="user_123"
 *     theme="auto"
 *   ></face-auth>
 *
 *   <script>
 *   const el = document.querySelector('face-auth')
 *   el.addEventListener('veriface:success', (e) => console.log(e.detail.token))
 *   el.addEventListener('veriface:failure', (e) => console.warn(e.detail.code))
 *   </script>
 *
 * Attributes:
 *   tenant-id        — Required. Tenant ID from /api/tenant.
 *   api-key          — Required. vf_live_... or vf_test_... API key.
 *   flow             — 'enroll' | 'authenticate' (default: 'authenticate')
 *   external-user-id — Optional. User identifier in your system.
 *   theme            — 'light' | 'dark' | 'auto' (default: 'auto')
 *   capture-duration — Milliseconds (default: 1800)
 *   liveness-threshold — 0.0–1.0 (default: 0.78)
 *
 * Events:
 *   veriface:success — { token, expiresAt, liveness, commitment }
 *   veriface:failure — { code, message }
 *   veriface:status  — { status }
 *   veriface:frame   — { rppgProgress, liveness }
 */

import { VeriFace, VeriFaceError, type VeriFaceStatus, type VeriFaceLivenessReport } from './veriface'

const TEMPLATE = `
<style>
  :host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --vf-primary: #10b981;
    --vf-bg: #0f172a;
    --vf-surface: #1e293b;
    --vf-text: #f1f5f9;
    --vf-error: #ef4444;
    --vf-warning: #f59e0b;
    --vf-border: #334155;
  }
  :host([theme="light"]) {
    --vf-bg: #ffffff;
    --vf-surface: #f8fafc;
    --vf-text: #0f172a;
    --vf-border: #e2e8f0;
  }
  .vf-container {
    background: var(--vf-bg);
    color: var(--vf-text);
    border-radius: 12px;
    padding: 16px;
    border: 1px solid var(--vf-border);
    max-width: 100%;
  }
  .vf-video-wrap {
    position: relative;
    aspect-ratio: 4/3;
    background: #000;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }
  .vf-status {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(0,0,0,0.7);
    color: #fff;
  }
  .vf-status.capturing { background: var(--vf-primary); }
  .vf-status.failed { background: var(--vf-error); }
  .vf-progress {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    height: 3px;
    background: rgba(255,255,255,0.2);
    border-radius: 2px;
    overflow: hidden;
  }
  .vf-progress-bar {
    height: 100%;
    background: var(--vf-primary);
    transition: width 0.15s ease;
  }
  .vf-button {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: var(--vf-primary);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .vf-button:disabled { opacity: 0.5; cursor: not-allowed; }
  .vf-button:hover:not(:disabled) { opacity: 0.9; }
  .vf-error {
    color: var(--vf-error);
    font-size: 12px;
    margin-top: 8px;
    padding: 8px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 4px;
  }
  .vf-liveness {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
    font-size: 11px;
  }
  .vf-liveness-item {
    display: flex;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--vf-surface);
    border-radius: 4px;
  }
</style>
<div class="vf-container">
  <div class="vf-video-wrap">
    <video autoplay playsinline muted></video>
    <div class="vf-status">IDLE</div>
    <div class="vf-progress" style="display:none">
      <div class="vf-progress-bar" style="width:0%"></div>
    </div>
  </div>
  <button class="vf-button">Start Face Authentication</button>
  <div class="vf-error" style="display:none"></div>
  <div class="vf-liveness"></div>
</div>
`

export class FaceAuthElement extends HTMLElement {
  private shadow: ShadowRoot
  private video: HTMLVideoElement | null = null
  private statusEl: HTMLElement | null = null
  private progressEl: HTMLElement | null = null
  private progressBarEl: HTMLElement | null = null
  private buttonEl: HTMLButtonElement | null = null
  private errorEl: HTMLElement | null = null
  private livenessEl: HTMLElement | null = null
  private sdk: VeriFace | null = null

  static get observedAttributes() {
    return ['tenant-id', 'api-key', 'flow', 'external-user-id', 'theme', 'capture-duration', 'liveness-threshold']
  }

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
    this.shadow.innerHTML = TEMPLATE
  }

  connectedCallback() {
    this.video = this.shadow.querySelector('video')
    this.statusEl = this.shadow.querySelector('.vf-status')
    this.progressEl = this.shadow.querySelector('.vf-progress')
    this.progressBarEl = this.shadow.querySelector('.vf-progress-bar')
    this.buttonEl = this.shadow.querySelector('.vf-button')
    this.errorEl = this.shadow.querySelector('.vf-error')
    this.livenessEl = this.shadow.querySelector('.vf-liveness')

    this.buttonEl?.addEventListener('click', () => this.start())

    // Apply theme attribute
    const theme = this.getAttribute('theme') ?? 'auto'
    if (theme === 'light') this.setAttribute('theme', 'light')
    else if (theme === 'dark') this.setAttribute('theme', 'dark')
    else if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      this.setAttribute('theme', prefersDark ? 'dark' : 'light')
    }
  }

  private initSdk() {
    const tenantId = this.getAttribute('tenant-id')
    const apiKey = this.getAttribute('api-key')
    if (!tenantId || !apiKey) {
      this.showError('MISSING_CONFIG', 'tenant-id and api-key attributes are required')
      return null
    }

    const captureDuration = parseInt(this.getAttribute('capture-duration') ?? '1800', 10)
    const livenessThreshold = parseFloat(this.getAttribute('liveness-threshold') ?? '0.78')

    const sdk = new VeriFace({
      tenantId,
      apiKey,
      captureDurationMs: captureDuration,
      livenessThreshold,
    })

    sdk.onStatus((status) => {
      this.updateStatus(status)
      this.dispatchEvent(new CustomEvent('veriface:status', { detail: { status } }))
    })

    sdk.onFrame(({ rppgProgress, liveness }) => {
      if (this.progressBarEl) {
        this.progressBarEl.style.width = `${Math.min(100, rppgProgress * 100)}%`
      }
      if (this.livenessEl && liveness) {
        this.livenessEl.innerHTML = `
          <div class="vf-liveness-item"><span>rPPG</span><span>${(liveness.rppg * 100).toFixed(0)}%</span></div>
          <div class="vf-liveness-item"><span>PAD Texture</span><span>${(liveness.padTexture * 100).toFixed(0)}%</span></div>
          <div class="vf-liveness-item"><span>PAD Depth</span><span>${(liveness.padDepth * 100).toFixed(0)}%</span></div>
          <div class="vf-liveness-item"><span>Overall</span><span>${(liveness.overall * 100).toFixed(0)}%</span></div>
        `
      }
      this.dispatchEvent(new CustomEvent('veriface:frame', { detail: { rppgProgress, liveness } }))
    })

    return sdk
  }

  async start() {
    this.hideError()
    if (!this.sdk) {
      this.sdk = this.initSdk()
      if (!this.sdk) return
    }

    const flow = (this.getAttribute('flow') ?? 'authenticate') as 'enroll' | 'authenticate'
    const externalUserId = this.getAttribute('external-user-id') ?? undefined

    if (this.buttonEl) this.buttonEl.disabled = true

    try {
      if (this.video) this.sdk.attachVideo(this.video)
      await this.sdk.openCamera()
      if (this.video) {
        this.video.srcObject = (this.sdk as any).stream
        await this.video.play().catch(() => {})
      }

      const session = await this.sdk.initSession(flow, externalUserId)
      const { embedding, liveness, antiInjection, commitmentNonce } = await this.sdk.capture()
      const result = await this.sdk.verify(
        session.sessionId, session.challenge, session.backendPubKey,
        embedding, liveness, antiInjection, commitmentNonce, externalUserId,
      )

      if (result.success) {
        this.dispatchEvent(new CustomEvent('veriface:success', {
          detail: {
            token: result.authPayload?.token,
            expiresAt: result.authPayload?.expiresAt,
            liveness,
            commitment: result.commitment,
          },
        }))
      } else {
        this.showError(result.errorCode ?? 'UNKNOWN', result.errorMessage ?? 'Verification failed')
        this.dispatchEvent(new CustomEvent('veriface:failure', {
          detail: { code: result.errorCode, message: result.errorMessage },
        }))
      }
    } catch (e) {
      const err = e instanceof VeriFaceError ? e : new VeriFaceError('UNKNOWN', String(e))
      this.showError(err.code, err.message)
      this.dispatchEvent(new CustomEvent('veriface:failure', {
        detail: { code: err.code, message: err.message },
      }))
    } finally {
      if (this.buttonEl) this.buttonEl.disabled = false
      await this.sdk?.destroy()
    }
  }

  private updateStatus(status: VeriFaceStatus) {
    if (!this.statusEl) return
    this.statusEl.textContent = status.toUpperCase()
    this.statusEl.className = 'vf-status'
    if (status === 'capturing') {
      this.statusEl.classList.add('capturing')
      if (this.progressEl) this.progressEl.style.display = 'block'
    } else if (status === 'failed') {
      this.statusEl.classList.add('failed')
      if (this.progressEl) this.progressEl.style.display = 'none'
    } else if (status === 'success' || status === 'idle') {
      if (this.progressEl) this.progressEl.style.display = 'none'
    }
  }

  private showError(code: string, message: string) {
    if (this.errorEl) {
      this.errorEl.textContent = `${code}: ${message}`
      this.errorEl.style.display = 'block'
    }
  }

  private hideError() {
    if (this.errorEl) this.errorEl.style.display = 'none'
  }

  attributeChangedCallback(name: string, _old: string, _new: string) {
    // Re-init SDK on config change
    if (this.sdk && ['tenant-id', 'api-key'].includes(name)) {
      this.sdk.destroy()
      this.sdk = null
    }
  }
}

// Auto-register if running in browser
if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
  if (!customElements.get('face-auth')) {
    customElements.define('face-auth', FaceAuthElement)
  }
}

export default FaceAuthElement
