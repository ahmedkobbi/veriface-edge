/**
 * VeriFace Edge — Anti-injection defense tests
 */

import { test, expect, describe } from 'bun:test'
import {
  FrameTimingAnalyzer,
  ReplayFilter,
  MicroStrobeProbe,
  buildAntiInjectionReport,
  type DeviceScanResult,
  type TamperCheckResult,
  type DeviceAttestation,
} from '../src/sdk/anti-injection'

describe('FrameTimingAnalyzer', () => {
  test('real camera jitter: σ/μ in 0.1–0.4 range', () => {
    const analyzer = new FrameTimingAnalyzer(60)
    // Simulate Poisson-distributed arrivals (real camera)
    let t = 0
    for (let i = 0; i < 60; i++) {
      t += 33 + (Math.random() - 0.5) * 8  // 33ms ± 4ms
      analyzer.recordArrival(t)
    }
    const stats = analyzer.stats()
    expect(stats.cv).toBeGreaterThan(0.05)
    expect(analyzer.isSynthetic()).toBe(false)
  })

  test('synthetic stream: σ/μ < 0.05', () => {
    const analyzer = new FrameTimingAnalyzer(60)
    // Perfectly periodic arrivals (synthetic)
    for (let i = 0; i < 60; i++) {
      analyzer.recordArrival(i * 33.333)
    }
    const stats = analyzer.stats()
    expect(stats.cv).toBeLessThan(0.05)
    expect(analyzer.isSynthetic()).toBe(true)
  })

  test('insufficient samples: not flagged as synthetic', () => {
    const analyzer = new FrameTimingAnalyzer(60)
    analyzer.recordArrival(0)
    analyzer.recordArrival(33)
    expect(analyzer.isSynthetic()).toBe(false)
  })
})

describe('ReplayFilter', () => {
  // Mock ImageData for non-browser test environment
  function makeImageData(width: number, height: number, fill: (i: number) => number = () => Math.floor(Math.random() * 256)) {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i++) {
      data[i] = fill(i)
    }
    return { data, width, height, colorSpace: 'srgb' } as any
  }

  test('first occurrence: not a replay', () => {
    const filter = new ReplayFilter()
    const imageData = makeImageData(32, 32)
    const result = filter.checkFrame(imageData)
    expect(result.isReplay).toBe(false)
    expect(result.hash).toBeDefined()
  })

  test('identical frame: detected as replay', () => {
    const filter = new ReplayFilter()
    const imageData = makeImageData(32, 32, () => 42)
    const r1 = filter.checkFrame(imageData)
    const r2 = filter.checkFrame(imageData)
    expect(r1.isReplay).toBe(false)
    expect(r2.isReplay).toBe(true)
    expect(r1.hash).toBe(r2.hash)
  })

  test('different frames: not a replay', () => {
    const filter = new ReplayFilter()
    const img1 = makeImageData(32, 32, () => 100)
    const img2 = makeImageData(32, 32, () => 200)
    const r1 = filter.checkFrame(img1)
    const r2 = filter.checkFrame(img2)
    expect(r1.isReplay).toBe(false)
    expect(r2.isReplay).toBe(false)
    expect(r1.hash).not.toBe(r2.hash)
  })
})

describe('MicroStrobeProbe', () => {
  test('issues challenges with nonces', () => {
    const probe = new MicroStrobeProbe()
    const challenge = probe.issueChallenge()
    expect(challenge.intensity).toBeGreaterThan(200)
    expect(challenge.intensity).toBeLessThanOrEqual(255)
    expect(challenge.nonce).toBeDefined()
  })

  test('detects realistic reflection (1-5% luminance increase)', () => {
    const probe = new MicroStrobeProbe()
    const result = probe.checkResponse(100, 103)  // 3% increase
    expect(result.detected).toBe(true)
    expect(result.deltaPct).toBeCloseTo(3, 1)
  })

  test('rejects over-rendered reflection (>7%)', () => {
    const probe = new MicroStrobeProbe()
    const result = probe.checkResponse(100, 110)  // 10% increase
    expect(result.detected).toBe(false)
  })

  test('rejects zero delta (no reflection)', () => {
    const probe = new MicroStrobeProbe()
    const result = probe.checkResponse(100, 100)
    expect(result.detected).toBe(false)
  })
})

describe('buildAntiInjectionReport', () => {
  test('passes when all signals are clean', () => {
    const deviceScan: DeviceScanResult = {
      totalDevices: 2,
      realCameras: ['FaceTime HD', 'Logitech C920'],
      virtualCameras: [],
      suspiciousOnly: false,
    }
    const timing = new FrameTimingAnalyzer(60)
    // Add real-camera-like jitter
    let t = 0
    for (let i = 0; i < 60; i++) {
      t += 33 + (Math.random() - 0.5) * 8
      timing.recordArrival(t)
    }
    const tamper: TamperCheckResult = { passed: true, violations: [] }
    const attestation: DeviceAttestation = {
      platform: 'desktop',
      attestationAvailable: true,
      attestationData: null,
      algorithm: 'webauthn-platform',
    }
    const report = buildAntiInjectionReport(
      deviceScan, timing, false, tamper, attestation, 5, 3,
    )
    expect(report.passed).toBe(true)
    expect(report.failureReasons.length).toBe(0)
  })

  test('fails when only virtual cameras present', () => {
    const deviceScan: DeviceScanResult = {
      totalDevices: 1,
      realCameras: [],
      virtualCameras: ['OBS Virtual Camera'],
      suspiciousOnly: true,
    }
    const timing = new FrameTimingAnalyzer(60)
    const tamper: TamperCheckResult = { passed: true, violations: [] }
    const attestation: DeviceAttestation = {
      platform: 'desktop',
      attestationAvailable: false,
      attestationData: null,
      algorithm: null,
    }
    const report = buildAntiInjectionReport(
      deviceScan, timing, false, tamper, attestation, 0, 0,
    )
    expect(report.passed).toBe(false)
    expect(report.failureReasons).toContain('VIRTUAL_CAMERA_ONLY')
  })

  test('fails on extension tamper detection', () => {
    const deviceScan: DeviceScanResult = {
      totalDevices: 1,
      realCameras: ['Real Camera'],
      virtualCameras: [],
      suspiciousOnly: false,
    }
    const timing = new FrameTimingAnalyzer(60)
    const tamper: TamperCheckResult = {
      passed: false,
      violations: ['getContext appears patched'],
    }
    const attestation: DeviceAttestation = {
      platform: 'desktop',
      attestationAvailable: false,
      attestationData: null,
      algorithm: null,
    }
    const report = buildAntiInjectionReport(
      deviceScan, timing, false, tamper, attestation, 0, 0,
    )
    expect(report.passed).toBe(false)
    expect(report.failureReasons).toContain('EXTENSION_TAMPER')
  })
})
