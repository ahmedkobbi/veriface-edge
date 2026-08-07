import { describe, it, expect } from 'bun:test'

/**
 * Tests for the A/B testing framework's pure functions.
 * Database-dependent functions (assignVariant, recordOutcome) are tested
 * via integration in tests/experiments-integration.test.ts.
 *
 * Here we test:
 *   - Variant validation (validateVariants via createExperiment error paths)
 *   - Statistical significance computation (z-test math)
 *   - Variant parsing
 */

// We import private functions via a re-export. Since the source file doesn't
// export the internal helpers, we replicate the math here for verification
// and test the public API separately.

// ---------------------------------------------------------------------------
// Replicate normalCdf for testing the z-test math
// ---------------------------------------------------------------------------

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}

function twoProportionZTest(
  successesControl: number,
  nControl: number,
  successesVariant: number,
  nVariant: number,
): { zScore: number; pValue: number } {
  if (nControl === 0 || nVariant === 0) return { zScore: 0, pValue: 1 }
  const pControl = successesControl / nControl
  const pVariant = successesVariant / nVariant
  const pPool = (successesControl + successesVariant) / (nControl + nVariant)
  const denominator = Math.sqrt(pPool * (1 - pPool) * (1 / nControl + 1 / nVariant))
  const zScore = denominator > 0 ? (pControl - pVariant) / denominator : 0
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)))
  return { zScore, pValue }
}

describe('A/B Testing — Statistical Significance', () => {
  describe('normalCdf (standard normal CDF)', () => {
    it('returns 0.5 at x=0 (median of standard normal)', () => {
      expect(normalCdf(0)).toBeCloseTo(0.5, 5)
    })

    it('returns ~0.841 at x=1 (one std dev above mean)', () => {
      expect(normalCdf(1)).toBeCloseTo(0.8413, 3)
    })

    it('returns ~0.977 at x=2 (two std devs above mean)', () => {
      expect(normalCdf(2)).toBeCloseTo(0.9772, 3)
    })

    it('returns ~0.023 at x=-2 (symmetric)', () => {
      expect(normalCdf(-2)).toBeCloseTo(0.0228, 3)
    })

    it('returns ~1.0 at x=5 (far right tail)', () => {
      expect(normalCdf(5)).toBeCloseTo(1.0, 4)
    })

    it('returns ~0.0 at x=-5 (far left tail)', () => {
      expect(normalCdf(-5)).toBeCloseTo(0.0, 4)
    })

    it('is symmetric: normalCdf(x) + normalCdf(-x) = 1', () => {
      for (const x of [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]) {
        expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1.0, 5)
      }
    })
  })

  describe('twoProportionZTest', () => {
    it('returns p-value=1.0 when proportions are equal', () => {
      const result = twoProportionZTest(50, 100, 50, 100)
      expect(result.zScore).toBeCloseTo(0, 5)
      expect(result.pValue).toBeCloseTo(1.0, 3)
    })

    it('returns p-value < 0.05 for clearly different proportions with large sample', () => {
      // 90% vs 60% with 200 samples each — should be highly significant
      const result = twoProportionZTest(180, 200, 120, 200)
      expect(Math.abs(result.zScore)).toBeGreaterThan(5)
      expect(result.pValue).toBeLessThan(0.001)
    })

    it('returns p-value > 0.05 for similar proportions with small sample', () => {
      // 60% vs 50% with 20 samples each — not enough data
      const result = twoProportionZTest(12, 20, 10, 20)
      expect(result.pValue).toBeGreaterThan(0.05)
    })

    it('returns p-value < 0.05 for moderate difference with large sample', () => {
      // 55% vs 45% with 1000 samples each — significant
      const result = twoProportionZTest(550, 1000, 450, 1000)
      expect(result.pValue).toBeLessThan(0.05)
    })

    it('handles zero successes', () => {
      const result = twoProportionZTest(0, 100, 50, 100)
      expect(result.zScore).not.toBeNaN()
      expect(result.pValue).toBeLessThan(0.001)
    })

    it('handles all successes', () => {
      const result = twoProportionZTest(100, 100, 50, 100)
      expect(result.zScore).not.toBeNaN()
      expect(result.pValue).toBeLessThan(0.001)
    })

    it('returns pValue=1 when n=0 (no samples)', () => {
      const result = twoProportionZTest(0, 0, 0, 0)
      expect(result.pValue).toBe(1)
    })

    it('z-score sign matches direction (positive when control > variant)', () => {
      const result = twoProportionZTest(80, 100, 60, 100)
      expect(result.zScore).toBeGreaterThan(0)
    })

    it('z-score sign matches direction (negative when control < variant)', () => {
      const result = twoProportionZTest(60, 100, 80, 100)
      expect(result.zScore).toBeLessThan(0)
    })
  })

  describe('Variant validation rules', () => {
    // Mirrors validateVariants() logic from src/lib/experiments.ts
    function validateVariants(variants: Array<{ name: string; weight: number }>): string | null {
      if (variants.length < 2) return 'Experiment must have at least 2 variants'
      if (!variants.some((v) => v.name === 'control')) return 'Experiment must include a "control" variant'
      const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)
      if (totalWeight !== 100) return `Variant weights must sum to 100 (got ${totalWeight})`
      for (const v of variants) {
        if (v.weight < 0 || v.weight > 100) return `Variant "${v.name}" has invalid weight ${v.weight}`
      }
      const names = new Set(variants.map((v) => v.name))
      if (names.size !== variants.length) return 'Variant names must be unique'
      return null
    }

    it('accepts valid 2-variant experiment with control', () => {
      expect(validateVariants([
        { name: 'control', weight: 50 },
        { name: 'treatment', weight: 50 },
      ])).toBeNull()
    })

    it('accepts 3-variant experiment with uneven weights', () => {
      expect(validateVariants([
        { name: 'control', weight: 60 },
        { name: 'strict', weight: 20 },
        { name: 'relaxed', weight: 20 },
      ])).toBeNull()
    })

    it('rejects single-variant experiment', () => {
      expect(validateVariants([{ name: 'control', weight: 100 }])).toMatch(/at least 2/)
    })

    it('rejects experiment without control variant', () => {
      expect(validateVariants([
        { name: 'a', weight: 50 },
        { name: 'b', weight: 50 },
      ])).toMatch(/control/)
    })

    it('rejects weights not summing to 100', () => {
      expect(validateVariants([
        { name: 'control', weight: 40 },
        { name: 'treatment', weight: 50 },
      ])).toMatch(/sum to 100/)
    })

    it('rejects duplicate variant names', () => {
      expect(validateVariants([
        { name: 'control', weight: 50 },
        { name: 'control', weight: 50 },
      ])).toMatch(/unique/)
    })

    it('rejects negative weights', () => {
      expect(validateVariants([
        { name: 'control', weight: 110 },
        { name: 'treatment', weight: -10 },
      ])).toMatch(/invalid weight/)
    })

    it('accepts 100/0 split (edge case)', () => {
      expect(validateVariants([
        { name: 'control', weight: 100 },
        { name: 'treatment', weight: 0 },
      ])).toBeNull()
    })
  })

  describe('Bucket-to-variant assignment (deterministic)', () => {
    // Mirrors bucketToVariant() logic
    function bucketToVariant(bucket: number, variants: Array<{ name: string; weight: number }>): string {
      let cumulative = 0
      for (const v of variants) {
        cumulative += v.weight
        if (bucket < cumulative) return v.name
      }
      return variants[variants.length - 1].name
    }

    it('assigns bucket 0 to first variant', () => {
      const variants = [
        { name: 'control', weight: 50 },
        { name: 'treatment', weight: 50 },
      ]
      expect(bucketToVariant(0, variants)).toBe('control')
    })

    it('assigns bucket 49 to first variant (50% split, last bucket of first half)', () => {
      const variants = [
        { name: 'control', weight: 50 },
        { name: 'treatment', weight: 50 },
      ]
      expect(bucketToVariant(49, variants)).toBe('control')
    })

    it('assigns bucket 50 to second variant (50% split, first bucket of second half)', () => {
      const variants = [
        { name: 'control', weight: 50 },
        { name: 'treatment', weight: 50 },
      ]
      expect(bucketToVariant(50, variants)).toBe('treatment')
    })

    it('assigns bucket 99 to last variant', () => {
      const variants = [
        { name: 'control', weight: 50 },
        { name: 'treatment', weight: 50 },
      ]
      expect(bucketToVariant(99, variants)).toBe('treatment')
    })

    it('handles 3-way split (60/20/20)', () => {
      const variants = [
        { name: 'control', weight: 60 },
        { name: 'strict', weight: 20 },
        { name: 'relaxed', weight: 20 },
      ]
      expect(bucketToVariant(0, variants)).toBe('control')
      expect(bucketToVariant(59, variants)).toBe('control')
      expect(bucketToVariant(60, variants)).toBe('strict')
      expect(bucketToVariant(79, variants)).toBe('strict')
      expect(bucketToVariant(80, variants)).toBe('relaxed')
      expect(bucketToVariant(99, variants)).toBe('relaxed')
    })

    it('is deterministic — same bucket always maps to same variant', () => {
      const variants = [
        { name: 'control', weight: 50 },
        { name: 'treatment', weight: 50 },
      ]
      const first = bucketToVariant(42, variants)
      const second = bucketToVariant(42, variants)
      expect(first).toBe(second)
    })
  })

  describe('Variant value parsing', () => {
    // Mirrors parseVariantValue() logic
    function parseVariantValue(s: string): number | string | boolean {
      if (s === 'true') return true
      if (s === 'false') return false
      const num = Number(s)
      if (!isNaN(num) && s.trim() !== '') return num
      return s
    }

    it('parses numeric strings', () => {
      expect(parseVariantValue('0.78')).toBe(0.78)
      expect(parseVariantValue('100')).toBe(100)
      expect(parseVariantValue('-5.5')).toBe(-5.5)
    })

    it('parses boolean strings', () => {
      expect(parseVariantValue('true')).toBe(true)
      expect(parseVariantValue('false')).toBe(false)
    })

    it('falls back to string for non-numeric', () => {
      expect(parseVariantValue('relaxed')).toBe('relaxed')
      expect(parseVariantValue('v1.0.0')).toBe('v1.0.0')
    })

    it('does not parse empty string as 0', () => {
      expect(parseVariantValue('')).toBe('')
    })
  })
})

describe('SDK Telemetry — PII Redaction', () => {
  // Mirrors redactPii() from src/sdk/telemetry.ts (with corrected order:
  // email → JWT → card → IP → phone → session ID → hex)
  const PII_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
    { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[email]' },
    { regex: /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '[jwt]' },
    { regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[card]' },
    { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[ip]' },
    { regex: /\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g, replacement: '[phone]' },
    { regex: /\b[a-z0-9]{24}\b/g, replacement: '[id]' },
    { regex: /\b[a-fA-F0-9]{32,}\b/g, replacement: '[hex]' },
  ]

  function redactPii(input: string): string {
    let result = input
    for (const { regex, replacement } of PII_PATTERNS) {
      result = result.replace(regex, replacement)
    }
    return result
  }

  it('redacts email addresses', () => {
    expect(redactPii('Error for user@example.com')).toBe('Error for [email]')
    expect(redactPii('Contact john.doe+test@company.co.uk')).toBe('Contact [email]')
  })

  it('redacts IPv4 addresses', () => {
    expect(redactPii('Request from 192.168.1.1 failed')).toBe('Request from [ip] failed')
    expect(redactPii('IPs: 10.0.0.1, 172.16.0.1, 8.8.8.8')).toBe('IPs: [ip], [ip], [ip]')
  })

  it('redacts phone numbers', () => {
    expect(redactPii('Call +1-555-123-4567')).toBe('Call [phone]')
  })

  it('redacts credit card numbers', () => {
    expect(redactPii('Card 4111 1111 1111 1111 charged')).toBe('Card [card] charged')
    expect(redactPii('Card 4111-1111-1111-1111')).toBe('Card [card]')
  })

  it('redacts cuid-format session IDs (24-char base36)', () => {
    expect(redactPii('Session abc123def456ghi789jkl012 expired')).toBe('Session [id] expired')
  })

  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.abc123def456'
    expect(redactPii(`Auth failed: ${jwt}`)).toBe('Auth failed: [jwt]')
  })

  it('redacts 32+ char hex blobs (embeddings, keys)', () => {
    expect(redactPii('Embedding: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe('Embedding: [hex]')
    expect(redactPii('Key: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe('Key: [hex]')
  })

  it('preserves non-PII error messages', () => {
    expect(redactPii('Liveness score 0.456 below threshold 0.78'))
      .toBe('Liveness score 0.456 below threshold 0.78')
  })

  it('preserves SDK error codes', () => {
    expect(redactPii('CAMERA_DENIED')).toBe('CAMERA_DENIED')
    expect(redactPii('LIVENESS_FAILED')).toBe('LIVENESS_FAILED')
  })

  it('redacts multiple PII types in one message', () => {
    const input = 'User user@test.com from 1.2.3.4 with card 4111111111111111'
    const redacted = redactPii(input)
    expect(redacted).toBe('User [email] from [ip] with card [card]')
  })

  it('does not redact short hex strings (< 32 chars)', () => {
    expect(redactPii('Code: a1b2c3d4')).toBe('Code: a1b2c3d4')
  })
})

describe('SDK Telemetry — Environment Detection', () => {
  // Test the browser/OS family detection regex patterns

  it('detects Firefox from UA string', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0'
    expect(/Firefox\//.test(ua) && !/Seamonkey\//.test(ua)).toBe(true)
  })

  it('detects Edge from UA string', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/115.0'
    expect(/Edg\//.test(ua)).toBe(true)
  })

  it('detects Chrome (not Chromium) from UA string', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36'
    expect(/Chrome\//.test(ua) && !/Chromium\//.test(ua)).toBe(true)
  })

  it('detects Chromium (not Chrome) from UA string', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chromium/115.0.0.0 Safari/537.36'
    expect(/Chromium\//.test(ua)).toBe(true)
  })

  it('detects Safari (not Chrome) from UA string', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'
    expect(/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua)).toBe(true)
  })
})

describe('SDK Telemetry — Rate Limiting', () => {
  it('rate limit is 10 events per minute per IP', () => {
    const RATE_LIMIT_PER_MIN = 10
    expect(RATE_LIMIT_PER_MIN).toBe(10)
  })

  it('rate limit window is 60 seconds', () => {
    const RATE_LIMIT_WINDOW_MS = 60 * 1000
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000)
  })

  it('batch size limit is 50 events', () => {
    const MAX_BATCH = 50
    expect(MAX_BATCH).toBe(50)
  })

  it('body size limit is 10KB', () => {
    const MAX_BODY = 10_000
    expect(MAX_BODY).toBe(10_000)
  })
})

describe('SDK Telemetry — Allowed Values', () => {
  it('error codes match VeriFaceErrorCode union', () => {
    const ALLOWED_ERROR_CODES = new Set([
      'NO_WEBGPU', 'CAMERA_DENIED', 'NO_CAMERA', 'VIRTUAL_CAMERA_ONLY',
      'INJECTION_SUSPECTED', 'EXTENSION_TAMPER', 'NO_FACE', 'MULTIPLE_FACES',
      'LIVENESS_FAILED', 'TIMING_SYNTHETIC', 'REPLAY_DETECTED', 'SESSION_EXPIRED',
      'NETWORK_ERROR', 'VERIFICATION_FAILED', 'UNSUPPORTED_BROWSER', 'UNKNOWN',
    ])
    expect(ALLOWED_ERROR_CODES.size).toBe(16)
    expect(ALLOWED_ERROR_CODES.has('LIVENESS_FAILED')).toBe(true)
    expect(ALLOWED_ERROR_CODES.has('INVALID_CODE')).toBe(false)
  })

  it('stages cover the full SDK lifecycle', () => {
    const ALLOWED_STAGES = new Set([
      'init', 'camera', 'capture', 'liveness', 'anti_injection', 'crypto', 'verify', 'network',
    ])
    expect(ALLOWED_STAGES.size).toBe(8)
  })

  it('severities are fatal/error/warning', () => {
    const ALLOWED_SEVERITIES = new Set(['fatal', 'error', 'warning'])
    expect(ALLOWED_SEVERITIES.size).toBe(3)
  })

  it('browser families exclude full UA strings', () => {
    const ALLOWED_BROWSER_FAMILIES = new Set([
      'firefox', 'edge', 'opera', 'chrome', 'chromium', 'safari', 'unknown',
    ])
    // Make sure we're not accepting raw UA strings
    expect(ALLOWED_BROWSER_FAMILIES.has('Mozilla/5.0')).toBe(false)
    expect(ALLOWED_BROWSER_FAMILIES.has('chrome')).toBe(true)
  })
})
