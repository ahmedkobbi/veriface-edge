/**
 * POST /api/auth/login
 * Authenticate a platform user with email + password.
 *
 * Body: { email, password }
 * Returns: { user } + sets session cookie
 *
 * Email triggers fired:
 *   - On 5+ failed logins within 10 min from same IP → notifyFailedLogins
 *   - On successful login from new device fingerprint → notifyNewDeviceLogin
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  verifyPassword,
  createSessionToken,
  buildCookieHeader,
  toPublicUser,
} from '@/lib/platform-auth'
import { safeErrorResponse } from '@/lib/config'
import { logger } from '@/lib/logger'
import { sha256Hex } from '@/lib/crypto-server'
import { notifyFailedLogins, notifyNewDeviceLogin } from '@/lib/email-notifications'

// In-memory failed-login tracker (per IP+email, 10-min window).
// In production: Redis with TTL. Here: Map with periodic cleanup.
interface FailRecord {
  count: number
  firstAt: number
}
const failedLoginTracker = new Map<string, FailRecord>()

// Cleanup every 5 min — remove entries older than 10 min
setInterval(() => {
  const now = Date.now()
  for (const [key, rec] of failedLoginTracker) {
    if (now - rec.firstAt > 10 * 60 * 1000) failedLoginTracker.delete(key)
  }
}, 5 * 60 * 1000).unref?.()

function recordFailedLogin(email: string, ip: string): { count: number; shouldAlert: boolean } {
  const key = `${email}:${ip}`
  const now = Date.now()
  const existing = failedLoginTracker.get(key)
  if (!existing || now - existing.firstAt > 10 * 60 * 1000) {
    failedLoginTracker.set(key, { count: 1, firstAt: now })
    return { count: 1, shouldAlert: false }
  }
  existing.count++
  // Alert on 5th, 10th, 20th, 50th failed attempt (exponential backoff to avoid spam)
  const thresholds = [5, 10, 20, 50, 100]
  const shouldAlert = thresholds.includes(existing.count)
  return { count: existing.count, shouldAlert }
}

function clearFailedLogins(email: string, ip: string): void {
  failedLoginTracker.delete(`${email}:${ip}`)
}

// Track known device fingerprints per user (for new-device detection).
// In production: Redis set per user. Here: in-memory Map.
const knownDevices = new Map<string, Set<string>>()

function isNewDevice(userId: string, fingerprint: string): boolean {
  let set = knownDevices.get(userId)
  if (!set) {
    set = new Set()
    knownDevices.set(userId, set)
  }
  if (set.has(fingerprint)) return false
  set.add(fingerprint)
  return true
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password required' }, { status: 400 })
    }

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const userAgent = req.headers.get('user-agent') ?? 'unknown'

    // SECURITY FIX (H-2): Rate limit auth endpoints to prevent brute-force.
    // 5 login attempts per IP per 10 minutes.
    const rateLimitKey = `auth_login:${clientIp}`
    const { rateLimitCache } = await import('@/lib/auth')
    const rl = await rateLimitCache.get(rateLimitKey) ?? { count: 0, windowStart: Date.now() }
    const WINDOW_MS = 10 * 60 * 1000
    if (Date.now() - rl.windowStart > WINDOW_MS) {
      rl.count = 0
      rl.windowStart = Date.now()
    }
    if (rl.count >= 5) {
      return NextResponse.json(
        { success: false, error: 'Too many login attempts. Try again later.', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '600' } },
      )
    }
    rl.count++
    rateLimitCache.set(rateLimitKey, rl)

    const user = await db.platformUser.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        emailVerified: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        twoFactorBackupCodes: true,
        mustChangePassword: true,
        createdAt: true,
        lastLoginAt: true,
      },
    })

    // Generic error to avoid user enumeration
    const invalidCredentialsResponse = NextResponse.json(
      { success: false, error: 'Invalid credentials' },
      { status: 401 },
    )

    // SECURITY FIX (H-1): Always run bcrypt.compare() even when user is not found,
    // to prevent timing-based user enumeration. Previously, missing users returned
    // immediately (~1ms) while existing users took ~100ms (bcrypt) — revealing
    // which emails are registered.
    const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy' // bcrypt hash of 'dummy'
    const hashToVerify = user?.passwordHash ?? DUMMY_HASH
    const valid = await verifyPassword(password, hashToVerify)

    if (!user || !valid) {
      if (user) {
        const { count, shouldAlert } = recordFailedLogin(email.toLowerCase(), clientIp)
        if (shouldAlert) {
          void notifyFailedLogins({
            tenantId: user.tenantId ?? 'unknown',
            to: user.email,
            userId: user.id,
            name: user.name ?? undefined,
            attempts: count,
            window: '10 minutes',
            ip: clientIp,
          }).catch((e) => logger.warn({ error: e }, 'Failed to enqueue failed-login email'))
        }
      }
      return invalidCredentialsResponse
    }

    // Clear failed login counter on success
    clearFailedLogins(email.toLowerCase(), clientIp)

    // Check if 2FA is enabled (TOTP or WebAuthn)
    if (user.twoFactorEnabled) {
      // Check if the user has WebAuthn credentials (hardware key / passkey)
      const webauthnCreds = await db.webAuthnCredential.findMany({
        where: { userId: user.id },
        select: { id: true, deviceType: true, aaguid: true },
      })

      // Don't issue session cookie yet — require 2FA
      const { createTwoFactorPendingToken } = await import('@/lib/totp')
      const pendingToken = await createTwoFactorPendingToken(user.id, user.email)

      logger.info(
        { userId: user.id, email: user.email, hasWebAuthn: webauthnCreds.length > 0 },
        '2FA challenge required',
      )

      return NextResponse.json({
        success: false,
        requiresTwoFactor: true,
        pendingToken,
        // Tell the client which 2FA methods are available
        twoFactorMethods: {
          totp: user.twoFactorEnabled,
          webauthn: webauthnCreds.length > 0,
        },
        webauthnCredentialCount: webauthnCreds.length,
        // SECURITY FIX (M-11): Surface mustChangePassword so the client can
        // redirect to the password-change page after completing 2FA.
        mustChangePassword: user.mustChangePassword,
        message: webauthnCreds.length > 0
          ? 'Use your hardware key / passkey, or enter the 6-digit code from your authenticator app.'
          : 'Enter the 6-digit code from your authenticator app.',
      })
    }

    // Update lastLoginAt
    await db.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // New device detection (best-effort)
    try {
      const browserFamily = userAgent.match(/(Firefox|Chrome|Safari|Edge|Opera)\/[\d.]+/)?.[0] ?? 'unknown'
      const osFamily = userAgent.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] ?? 'unknown'
      const fingerprint = sha256Hex(`${clientIp}|${browserFamily}|${osFamily}`)
      if (isNewDevice(user.id, fingerprint) && user.tenantId) {
        void notifyNewDeviceLogin({
          tenantId: user.tenantId,
          to: user.email,
          userId: user.id,
          name: user.name ?? undefined,
          ip: clientIp,
          device: `${browserFamily} on ${osFamily}`,
        }).catch((e) => logger.warn({ error: e }, 'Failed to enqueue new-device email'))
      }
    } catch (e) {
      logger.warn({ error: e }, 'New-device detection failed (non-blocking)')
    }

    // Issue session token
    const token = await createSessionToken(user.id, user.email, user.tenantId)

    logger.info({ userId: user.id, email: user.email }, 'User logged in')

    const response = NextResponse.json({
      success: true,
      user: toPublicUser(user),
    })
    response.headers.set('Set-Cookie', buildCookieHeader(token))
    return response
  } catch (e) {
    logger.error({ error: e }, 'Login failed')
    return NextResponse.json(safeErrorResponse(e), { status: 500 })
  }
}
