/**
 * VeriFace Edge SDK — Public TypeScript Types
 *
 * Re-exports the public API surface of the SDK for type-safe consumption
 * by frontend applications. Framework bindings (React, Vue, Web Component)
 * re-export from here.
 */

export type { VeriFaceConfig, VeriFaceStatus, VeriFaceErrorCode, VeriFaceLivenessReport, VeriFaceResult } from './veriface'
export { VeriFace, VeriFaceError } from './veriface'

export type { AntiInjectionReport, DeviceScanResult, TamperCheckResult, DeviceAttestation } from './anti-injection'
export type { DetectedFace } from './ai-pipeline'

export type { JwtClaims, JwtHeader, Ed25519KeyPair, X25519KeyPair, AesGcmCiphertext } from './crypto'

// ---------------------------------------------------------------------------
// Backend API types (mirrors server-side Zod schemas for client use)
// ---------------------------------------------------------------------------

export interface SessionInitResponse {
  success: boolean
  sessionId: string
  challenge: string  // hex
  backendPubKey: string  // hex X25519 public key
  expiresAt: string  // ISO timestamp
}

export interface SessionVerifyPayload {
  sessionId: string
  tenantId: string
  jwt: string
  sdkPubKey: string
  encryptedEmbedding: {
    ciphertext: string
    iv: string
    authTag: string
  }
  commitment: string
  commitmentNonce: string
  liveness: VeriFaceLivenessReport
  antiInjection: AntiInjectionReport
  externalUserId?: string
}

export interface SessionVerifyResponse {
  success: boolean
  token?: string
  expiresAt?: number
  sessionId: string
  flow: string
  liveness: VeriFaceLivenessReport
  outcome?: {
    matched?: boolean
    cosineSimilarity?: number
    templateId?: string
  }
  errorCode?: string
  error?: string
}

export interface TenantCreateResponse {
  success: boolean
  tenant: {
    id: string
    name: string
    signingPubKey: string
    webhookSecret: string
    kmsKeyId: string
  }
  signingPrivateKey: string
  apiKey: string
  apiKeyId: string
}

export interface AuditEntry {
  id: string
  eventType: string
  payload: Record<string, unknown>
  chainIndex: number
  prevHash: string
  thisHash: string
  actorIp: string | null
  apiKeyId: string | null
  createdAt: string
}

export interface ApiKeyInfo {
  id: string
  tenantId: string
  label: string
  scopes: string
  keyPrefix: string
  lastFour: string
  active: boolean
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetAt: number
}

// ---------------------------------------------------------------------------
// Event types (for SDK status / frame callbacks)
// ---------------------------------------------------------------------------

export type VeriFaceEvent =
  | { type: 'status'; status: VeriFaceStatus; detail?: unknown }
  | { type: 'frame'; video: HTMLVideoElement; face: DetectedFace | null; rppgProgress: number; liveness: VeriFaceLivenessReport | null }
  | { type: 'success'; result: VeriFaceResult }
  | { type: 'error'; error: VeriFaceError }

// ---------------------------------------------------------------------------
// Theme support
// ---------------------------------------------------------------------------

export type VeriFaceTheme = 'light' | 'dark' | 'auto'

export interface ThemeConfig {
  primary: string
  background: string
  surface: string
  text: string
  success: string
  warning: string
  error: string
}

export const DEFAULT_THEMES: Record<'light' | 'dark', ThemeConfig> = {
  light: {
    primary: '#059669',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  },
  dark: {
    primary: '#10b981',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f1f5f9',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  },
}
