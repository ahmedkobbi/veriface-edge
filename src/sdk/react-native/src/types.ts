/**
 * VeriFace React Native — Type definitions
 * Mirrors the web SDK types.
 */

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
  | 'UNSUPPORTED_PLATFORM'
  | 'UNKNOWN'

export interface VeriFaceLivenessReport {
  rppg: number
  rppgHeartRateBpm: number | null
  rppgSnr: number
  padTexture: number
  padDepth: number
  padCombined: number
  overall: number
}

export interface VeriFaceConfig {
  /** Required: tenant ID from /api/tenant */
  tenantId: string
  /** Required: vf_live_... or vf_test_... API key */
  apiKey: string
  /** Base URL of the VeriFace backend. Defaults to https://api.veriface.io */
  apiBaseUrl?: string
  /** 'enroll' or 'authenticate' (default: 'authenticate') */
  flow?: 'enroll' | 'authenticate'
  /** User identifier in your system (required for enroll, optional for authenticate) */
  externalUserId?: string
  /** Capture duration in ms (default: 1800) */
  captureDurationMs?: number
  /** Liveness threshold 0.0–1.0 (default: 0.78) */
  livenessThreshold?: number
  /** Theme: 'light' | 'dark' | 'auto' (default: 'auto') */
  theme?: 'light' | 'dark' | 'auto'
  /** Opt-in anonymous telemetry (default: false) */
  telemetryOptIn?: boolean
}

export interface VeriFaceResult {
  success: boolean
  sessionId: string
  token?: string
  expiresAt?: number
  liveness: VeriFaceLivenessReport
  errorCode?: VeriFaceErrorCode
  errorMessage?: string
}

export interface VeriFaceViewProps extends VeriFaceConfig {
  /** Style for the wrapping WebView container */
  style?: import('react-native').ViewStyle
  /** Called when authentication succeeds */
  onSuccess?: (result: VeriFaceResult) => void
  /** Called when authentication fails */
  onFailure?: (error: { code: VeriFaceErrorCode; message: string }) => void
  /** Called on status changes */
  onStatus?: (status: VeriFaceStatus) => void
  /** Called on rPPG/liveness frame updates */
  onFrame?: (data: { rppgProgress: number; liveness: VeriFaceLivenessReport | null }) => void
  /** Auto-start capture when component mounts (default: false) */
  autoStart?: boolean
  /** Show the built-in UI overlay (default: true). When false, you must call start() via ref. */
  showUi?: boolean
}

export interface VeriFaceViewRef {
  start: () => Promise<void>
  cancel: () => void
  setTelemetryOptIn: (optIn: boolean) => void
}
