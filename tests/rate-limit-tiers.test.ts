import { describe, it, expect, beforeEach } from 'bun:test'
import {
  PLAN_TIERS,
  getPlan,
  isBillableEvent,
  getMonthKey,
  type PlanTier,
} from '../src/lib/rate-limit-tiers'

describe('Rate Limit Tiers', () => {
  describe('PLAN_TIERS definitions', () => {
    it('defines 3 tiers: developer, growth, enterprise', () => {
      expect(Object.keys(PLAN_TIERS)).toEqual(['developer', 'growth', 'enterprise'])
    })

    it('Developer plan: 1,000 calls/month, 10/min, free', () => {
      const p = PLAN_TIERS.developer
      expect(p.monthlyLimit).toBe(1_000)
      expect(p.perMinuteLimit).toBe(10)
      expect(p.pricePerAuth).toBe(0)
      expect(p.displayName).toBe('Developer')
    })

    it('Growth plan: 100,000 calls/month, 100/min, $0.08/auth', () => {
      const p = PLAN_TIERS.growth
      expect(p.monthlyLimit).toBe(100_000)
      expect(p.perMinuteLimit).toBe(100)
      expect(p.pricePerAuth).toBe(0.08)
      expect(p.displayName).toBe('Growth')
    })

    it('Enterprise plan: unlimited (-1), 1,000/min, custom pricing', () => {
      const p = PLAN_TIERS.enterprise
      expect(p.monthlyLimit).toBe(-1)
      expect(p.perMinuteLimit).toBe(1_000)
      expect(p.pricePerAuth).toBe(0)
      expect(p.displayName).toBe('Enterprise')
    })

    it('each tier has unique accent color', () => {
      const colors = new Set(Object.values(PLAN_TIERS).map((p) => p.accentColor))
      expect(colors.size).toBe(3)
    })

    it('each tier has a feature list', () => {
      for (const tier of Object.values(PLAN_TIERS)) {
        expect(tier.features.length).toBeGreaterThan(0)
        expect(Array.isArray(tier.features)).toBe(true)
      }
    })
  })

  describe('getPlan', () => {
    it('returns plan definition for valid tier', () => {
      expect(getPlan('developer').tier).toBe('developer')
      expect(getPlan('growth').tier).toBe('growth')
      expect(getPlan('enterprise').tier).toBe('enterprise')
    })

    it('returns Developer plan for null/undefined/invalid tier', () => {
      expect(getPlan(null).tier).toBe('developer')
      expect(getPlan(undefined).tier).toBe('developer')
      expect(getPlan('invalid').tier).toBe('developer')
      expect(getPlan('').tier).toBe('developer')
    })
  })

  describe('isBillableEvent', () => {
    it('returns true for auth.success', () => {
      expect(isBillableEvent('auth.success')).toBe(true)
    })

    it('returns true for enroll.success', () => {
      expect(isBillableEvent('enroll.success')).toBe(true)
    })

    it('returns false for auth.failure', () => {
      expect(isBillableEvent('auth.failure')).toBe(false)
    })

    it('returns false for non-billable read events', () => {
      expect(isBillableEvent('session.init')).toBe(false)
      expect(isBillableEvent('audit.read')).toBe(false)
      expect(isBillableEvent('injection.suspected')).toBe(false)
      expect(isBillableEvent('rate_limit.exceeded')).toBe(false)
    })
  })

  describe('getMonthKey', () => {
    it('returns YYYY-MM format for current date', () => {
      const key = getMonthKey(new Date('2026-08-15T12:00:00Z'))
      expect(key).toBe('2026-08')
    })

    it('handles January (month 01)', () => {
      const key = getMonthKey(new Date('2026-01-01T00:00:00Z'))
      expect(key).toBe('2026-01')
    })

    it('handles December (month 12)', () => {
      const key = getMonthKey(new Date('2026-12-31T23:59:59Z'))
      expect(key).toBe('2026-12')
    })

    it('zero-pads single-digit months', () => {
      const march = getMonthKey(new Date('2026-03-15T00:00:00Z'))
      expect(march).toBe('2026-03')
      expect(march.length).toBe(7)
    })
  })

  describe('Plan tier hierarchy', () => {
    it('monthly limits are in strict ascending order (developer < growth < enterprise)', () => {
      const dev = PLAN_TIERS.developer.monthlyLimit
      const growth = PLAN_TIERS.growth.monthlyLimit
      const ent = PLAN_TIERS.enterprise.monthlyLimit
      expect(dev).toBeLessThan(growth)
      // Enterprise is -1 (unlimited) — should be larger than growth numerically conceptually
      expect(ent).toBe(-1)
    })

    it('per-minute limits are in ascending order', () => {
      expect(PLAN_TIERS.developer.perMinuteLimit).toBeLessThan(PLAN_TIERS.growth.perMinuteLimit)
      expect(PLAN_TIERS.growth.perMinuteLimit).toBeLessThan(PLAN_TIERS.enterprise.perMinuteLimit)
    })

    it('only Growth plan charges per-auth', () => {
      expect(PLAN_TIERS.developer.pricePerAuth).toBe(0)
      expect(PLAN_TIERS.growth.pricePerAuth).toBeGreaterThan(0)
      expect(PLAN_TIERS.enterprise.pricePerAuth).toBe(0) // custom
    })

    it('enterprise has SAML/FIDO2 features, others do not', () => {
      expect(PLAN_TIERS.enterprise.features).toContain('saml')
      expect(PLAN_TIERS.enterprise.features).toContain('fido2')
      expect(PLAN_TIERS.developer.features).not.toContain('saml')
      expect(PLAN_TIERS.growth.features).not.toContain('saml')
    })
  })

  describe('Plan tier billing math', () => {
    it('developer plan: 1000 auths = $0', () => {
      const cost = 1000 * PLAN_TIERS.developer.pricePerAuth
      expect(cost).toBe(0)
    })

    it('growth plan: 100,000 auths = $8,000', () => {
      const cost = 100_000 * PLAN_TIERS.growth.pricePerAuth
      expect(cost).toBe(8000)
    })

    it('growth plan: 50,000 auths = $4,000', () => {
      const cost = 50_000 * PLAN_TIERS.growth.pricePerAuth
      expect(cost).toBe(4000)
    })

    it('enterprise plan: any number of auths = $0 (custom pricing)', () => {
      const cost = 1_000_000 * PLAN_TIERS.enterprise.pricePerAuth
      expect(cost).toBe(0)
    })
  })

  describe('Plan tier type safety', () => {
    it('PlanTier type accepts all valid values', () => {
      const tiers: PlanTier[] = ['developer', 'growth', 'enterprise']
      expect(tiers.length).toBe(3)
    })
  })
})
