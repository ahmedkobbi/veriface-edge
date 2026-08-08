/**
 * VeriFace Edge — Platform Authentication
 *
 * Handles customer signup/login for the VeriFace platform itself.
 * Separate from biometric authentication — these are the enterprise
 * admins who manage tenants, API keys, and billing.
 *
 * Uses:
 *   - bcryptjs for password hashing (10 rounds)
 *   - Ed25519-signed JWT in httpOnly cookie (7-day expiry)
 *   - Email validation via Zod
 */

import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getServerSigningKey } from '@/lib/config'
import { signJwt } from '@/lib/jwt-server'
import { sha256Hex } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

const BCRYPT_ROUNDS = 10
const COOKIE_NAME = 'veriface_session'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 // 7 days in seconds

export interface PlatformUserPublic {
  id: string
  email: string
  name: string | null
  role: string
  tenantId: string | null
  emailVerified: boolean
  mustChangePassword: boolean
  createdAt: Date
  lastLoginAt: Date | null
}

export function toPublicUser(user: any): PlatformUserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    emailVerified: user.emailVerified,
    // SECURITY FIX (M-11): Surface mustChangePassword so the frontend can
    // redirect to the password-change page after login.
    mustChangePassword: user.mustChangePassword ?? false,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function isValidEmail(email: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)
}

export function isValidPassword(password: string): boolean {
  // At least 8 chars, 1 uppercase, 1 lowercase, 1 number
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)
}

export async function createSessionToken(userId: string, email: string, tenantId: string | null): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const serverKey = getServerSigningKey()
  return signJwt({
    iss: 'veriface-edge-platform',
    sub: userId,
    iat: now,
    exp: now + COOKIE_MAX_AGE,
    jti: crypto.randomUUID(),
    email,
    tenant_id: tenantId,
    type: 'platform_session',
  }, serverKey.privateKey)
}

export function buildCookieHeader(token: string): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

export async function verifySessionToken(token: string): Promise<{
  valid: boolean
  userId?: string
  email?: string
  tenantId?: string | null
} | null> {
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  const signingInput = parts[0] + '.' + parts[1]
  const sigB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/')
  const sigBin = atob(sigB64)
  const signature = new Uint8Array(sigBin.length)
  for (let i = 0; i < sigBin.length; i++) signature[i] = sigBin.charCodeAt(i)

  const serverKey = getServerSigningKey()
  const { ed25519Verify, utf8 } = await import('@/lib/crypto-server')
  if (!ed25519Verify(signature, utf8.encode(signingInput), serverKey.publicKey)) {
    return null
  }

  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const payloadBin = atob(payloadB64)
  const payloadBytes = new Uint8Array(payloadBin.length)
  for (let i = 0; i < payloadBin.length; i++) payloadBytes[i] = payloadBin.charCodeAt(i)
  const claims = JSON.parse(new TextDecoder().decode(payloadBytes))

  const now = Math.floor(Date.now() / 1000)
  if (claims.exp && claims.exp < now) return null
  if (claims.type !== 'platform_session') return null

  return {
    valid: true,
    userId: claims.sub,
    email: claims.email,
    tenantId: claims.tenant_id ?? null,
  }
}

export function getCookieFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split('=')
    if (name === COOKIE_NAME) {
      return valueParts.join('=')
    }
  }
  return null
}

/**
 * Create a platform user + auto-provision a tenant + API key.
 * Called during signup.
 */
export async function createPlatformUserWithTenant(opts: {
  email: string
  password: string
  name?: string
}): Promise<{ user: any; tenant: any; apiKey: string }> {
  const { createTenant } = await import('@/lib/tenant')
  const { createApiKey } = await import('@/lib/auth')

  const passwordHash = await hashPassword(opts.password)

  // Create tenant first
  const tenantResult = await createTenant(opts.name || opts.email.split('@')[0])

  // Create API key for the tenant
  const apiKeyResult = await createApiKey(tenantResult.tenant.id, {
    label: 'Initial API Key',
    scopes: '*',
    environment: 'live',
  })

  // Create platform user linked to tenant
  const user = await db.platformUser.create({
    data: {
      email: opts.email.toLowerCase(),
      passwordHash,
      name: opts.name,
      tenantId: tenantResult.tenant.id,
    },
  })

  logger.info({ userId: user.id, tenantId: tenantResult.tenant.id, email: opts.email }, 'Platform user created')

  return {
    user,
    tenant: tenantResult.tenant,
    apiKey: apiKeyResult.plaintext,
  }
}
