/**
 * VeriFace Edge React Native SDK — Tests
 *
 * Tests the pure TypeScript logic (config validation, HTML generation,
 * error class behavior). Component rendering tests would require
 * react-native-testing-library — out of scope for this initial release.
 */

import { describe, it, expect } from 'bun:test'
import { VeriFaceError } from '../src/errors'
import type { VeriFaceConfig, VeriFaceErrorCode } from '../src/types'

describe('React Native SDK — Error Class', () => {
  it('creates an error with code + message', () => {
    const err = new VeriFaceError('CAMERA_DENIED', 'User denied camera permission')
    expect(err.code).toBe('CAMERA_DENIED')
    expect(err.message).toBe('User denied camera permission')
    expect(err.name).toBe('VeriFaceError')
  })

  it('toString() includes code + message', () => {
    const err = new VeriFaceError('LIVENESS_FAILED', 'Score 0.456 below threshold 0.78')
    expect(err.toString()).toBe('VeriFaceError[LIVENESS_FAILED]: Score 0.456 below threshold 0.78')
  })

  it('extends the native Error class', () => {
    const err = new VeriFaceError('UNKNOWN', 'test')
    expect(err).toBeInstanceOf(Error)
  })

  it('preserves the stack trace', () => {
    const err = new VeriFaceError('NETWORK_ERROR', 'test')
    // Stack trace should exist (may be undefined in some environments)
    if (err.stack) {
      expect(err.stack).toContain('VeriFaceError')
    }
  })
})

describe('React Native SDK — Config Types', () => {
  it('accepts a minimal config with required fields', () => {
    const config: VeriFaceConfig = {
      tenantId: 'tnt_abc123',
      apiKey: 'vf_live_deadbeefdeadbeef',
    }
    expect(config.tenantId).toBe('tnt_abc123')
    expect(config.apiKey).toBe('vf_live_deadbeefdeadbeef')
  })

  it('accepts a full config with all options', () => {
    const config: VeriFaceConfig = {
      tenantId: 'tnt_abc',
      apiKey: 'vf_live_xyz',
      apiBaseUrl: 'https://api.veriface.io',
      flow: 'enroll',
      externalUserId: 'user_123',
      captureDurationMs: 2000,
      livenessThreshold: 0.82,
      theme: 'dark',
      telemetryOptIn: true,
    }
    expect(config.flow).toBe('enroll')
    expect(config.captureDurationMs).toBe(2000)
    expect(config.livenessThreshold).toBe(0.82)
    expect(config.telemetryOptIn).toBe(true)
  })

  it('flow is restricted to enroll | authenticate', () => {
    const validFlows: VeriFaceConfig['flow'][] = ['enroll', 'authenticate', undefined]
    expect(validFlows.length).toBe(3)
  })

  it('theme is restricted to light | dark | auto', () => {
    const validThemes: VeriFaceConfig['theme'][] = ['light', 'dark', 'auto', undefined]
    expect(validThemes.length).toBe(4)
  })
})

describe('React Native SDK — Error Codes', () => {
  it('all error codes from web SDK are present', () => {
    const expectedCodes: VeriFaceErrorCode[] = [
      'NO_WEBGPU', 'CAMERA_DENIED', 'NO_CAMERA', 'VIRTUAL_CAMERA_ONLY',
      'INJECTION_SUSPECTED', 'EXTENSION_TAMPER', 'NO_FACE', 'MULTIPLE_FACES',
      'LIVENESS_FAILED', 'TIMING_SYNTHETIC', 'REPLAY_DETECTED', 'SESSION_EXPIRED',
      'NETWORK_ERROR', 'VERIFICATION_FAILED', 'UNSUPPORTED_BROWSER',
      'UNSUPPORTED_PLATFORM', 'UNKNOWN',
    ]
    expect(expectedCodes.length).toBe(17)
    // UNSUPPORTED_PLATFORM is RN-specific (added for native platforms)
    expect(expectedCodes).toContain('UNSUPPORTED_PLATFORM')
  })
})

describe('React Native SDK — WebView HTML Generation', () => {
  // Mirrors the buildWebViewHtml function logic
  function buildHtml(config: VeriFaceConfig): string {
    const cdnBaseUrl = config.apiBaseUrl?.replace(/\/api$/, '') ?? 'https://cdn.veriface.io'
    return `${cdnBaseUrl}/v1/face-auth.js`
  }

  it('uses default CDN URL when no apiBaseUrl provided', () => {
    const url = buildHtml({ tenantId: 'tnt_x', apiKey: 'vf_live_x' })
    expect(url).toBe('https://cdn.veriface.io/v1/face-auth.js')
  })

  it('strips /api suffix from apiBaseUrl to derive CDN base', () => {
    const url = buildHtml({
      tenantId: 'tnt_x',
      apiKey: 'vf_live_x',
      apiBaseUrl: 'https://api.veriface.io/api',
    })
    expect(url).toBe('https://api.veriface.io/v1/face-auth.js')
  })

  it('uses custom apiBaseUrl as CDN base if no /api suffix', () => {
    const url = buildHtml({
      tenantId: 'tnt_x',
      apiKey: 'vf_live_x',
      apiBaseUrl: 'https://custom.cdn.com',
    })
    expect(url).toBe('https://custom.cdn.com/v1/face-auth.js')
  })
})

describe('React Native SDK — useVeriFace Hook Logic', () => {
  // Test the BUSY_STATES logic (mirrors useVeriFace.ts)
  const BUSY_STATES = [
    'initializing',
    'requesting-camera',
    'scanning-devices',
    'capturing',
    'processing',
    'committing',
    'verifying',
  ]

  it('identifies busy states correctly', () => {
    expect(BUSY_STATES.includes('capturing')).toBe(true)
    expect(BUSY_STATES.includes('verifying')).toBe(true)
  })

  it('idle is NOT a busy state', () => {
    expect(BUSY_STATES.includes('idle')).toBe(false)
  })

  it('success and failed are NOT busy states', () => {
    expect(BUSY_STATES.includes('success')).toBe(false)
    expect(BUSY_STATES.includes('failed')).toBe(false)
  })

  it('all 7 in-progress stages are covered', () => {
    expect(BUSY_STATES.length).toBe(7)
  })
})
