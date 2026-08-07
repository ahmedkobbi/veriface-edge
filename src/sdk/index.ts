/**
 * VeriFace Edge SDK — Public Entry Point
 *
 * Re-exports the public API for consumption by frontend applications.
 *
 * Usage:
 *   import { VeriFace, useFaceAuth } from '@veriface/edge-sdk'
 *   // or
 *   import { VeriFace } from '@veriface/edge-sdk'
 *   import { useFaceAuth } from '@veriface/edge-sdk/react'
 */

export { VeriFace, VeriFaceError } from './veriface'
export type {
  VeriFaceConfig,
  VeriFaceStatus,
  VeriFaceErrorCode,
  VeriFaceLivenessReport,
  VeriFaceResult,
} from './veriface'

export type {
  AntiInjectionReport,
  DeviceScanResult,
  TamperCheckResult,
  DeviceAttestation,
} from './anti-injection'

export type { DetectedFace } from './ai-pipeline'

export type {
  JwtClaims,
  JwtHeader,
  Ed25519KeyPair,
  X25519KeyPair,
  AesGcmCiphertext,
} from './crypto'

export type {
  VeriFaceTheme,
  ThemeConfig,
  SessionInitResponse,
  SessionVerifyResponse,
  TenantCreateResponse,
  AuditEntry,
  ApiKeyInfo,
  RateLimitInfo,
} from './types'

export { DEFAULT_THEMES } from './types'

export { generateNeuralEmbedding, preloadNeuralModel } from './neural-embedding'

// React hook (only if React is available)
export { useFaceAuth } from './react'
