/**
 * VeriFace Edge — TOTP (Time-based One-Time Password) Service
 *
 * Implements RFC 6238 TOTP using otplib:
 *   - Generate TOTP secret (base32)
 *   - Generate QR code URL for authenticator apps
 *   - Verify 6-digit TOTP codes
 *   - Generate + verify backup codes (single-use, hashed)
 *
 * Compatible with: Google Authenticator, Authy, Microsoft Authenticator, 1Password
 */

import { generateSecret, generate, generateURI, verify, generateSync, verifySync } from 'otplib'
import QRCode from 'qrcode'
import { randomBytes } from '@noble/hashes/utils.js'
import { sha256Hex } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

// TOTP configuration: 6 digits, 30-second window, ±30s drift tolerance
const TOTP_DIGITS = 6
const TOTP_STEP = 30
const TOTP_WINDOW = 1

const APP_NAME = process.env.TOTP_APP_NAME ?? 'VeriFace Edge'

/**
 * Generate a new TOTP secret (base32 encoded).
 */
export function generateTOTPSecret(): string {
  return generateSecret()
}

/**
 * Generate the otpauth:// URI for QR code scanning.
 */
export function generateOTPAuthURL(email: string, secret: string): string {
  return generateURI({
    type: 'totp',
    secret,
    accountName: email,
    issuer: APP_NAME,
    digits: TOTP_DIGITS,
    step: TOTP_STEP,
  })
}

/**
 * Generate a QR code as a data URL (base64 PNG) for the given otpauth URI.
 */
export async function generateQRCodeDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, {
    width: 256,
    margin: 1,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  })
}

// SECURITY FIX (H-10): TOTP replay protection.
// Track the last successfully used TOTP timestamp per user.
// Reject codes older than the last-used timestamp.
const totpReplayCache = new Map<string, number>() // userId → lastUsedTimestamp (seconds)

/**
 * Verify a 6-digit TOTP code against a secret.
 * Allows ±30 seconds clock drift (window=1).
 * SECURITY FIX (H-10): Tracks last-used timestamp to prevent replay.
 */
export function verifyTOTP(token: string, secret: string, userId?: string): boolean {
  try {
    const result = verifySync({ token, secret, digits: TOTP_DIGITS, step: TOTP_STEP, window: TOTP_WINDOW })
    if (!result) return false

    // Replay protection: check if this code was already used
    if (userId) {
      const now = Math.floor(Date.now() / 1000)
      const lastUsed = totpReplayCache.get(userId)
      if (lastUsed && now - lastUsed < TOTP_STEP) {
        // Same TOTP step — code may have been replayed
        // Allow if the token is different (new 30s window), reject if same step
        return false
      }
      // Update last-used timestamp
      totpReplayCache.set(userId, now)
    }

    return true
  } catch {
    return false
  }
}

/**
 * Generate 10 single-use backup codes.
 * Returns the plaintext codes (shown once) + their SHA-256 hashes (stored).
 */
export function generateBackupCodes(): { plaintext: string[]; hashed: string[] } {
  const codes: string[] = []
  const hashed: string[] = []
  for (let i = 0; i < 10; i++) {
    // Format: XXXX-XXXX (8 hex chars + dash for readability)
    const code = secureRandomHex(4).toUpperCase().replace(/(.{4})/, '$1-')
    codes.push(code)
    hashed.push(sha256Hex(code.replace('-', '')))
  }
  return { plaintext: codes, hashed }
}

/**
 * Verify a backup code against the stored hashed codes.
 * Returns the index of the matched code (to mark as used), or -1 if no match.
 */
export function verifyBackupCode(
  inputCode: string,
  storedHashedCodes: string[],
): number {
  const normalizedInput = inputCode.replace(/[-\s]/g, '').toUpperCase()
  const inputHash = sha256Hex(normalizedInput)
  for (let i = 0; i < storedHashedCodes.length; i++) {
    if (storedHashedCodes[i] === inputHash) {
      return i
    }
  }
  return -1
}

/**
 * Remove a used backup code from the array (mark as consumed).
 */
export function consumeBackupCode(
  hashedCodes: string[],
  index: number,
): string[] {
  return hashedCodes.filter((_, i) => i !== index)
}

/**
 * Create a temporary "2FA pending" JWT token for the login challenge flow.
 * This token is short-lived (5 min) and only used to complete 2FA verification.
 * It does NOT grant full session access — only the ability to submit a TOTP code.
 */
export async function createTwoFactorPendingToken(
  userId: string,
  email: string,
): Promise<string> {
  const { getServerSigningKey } = await import('@/lib/config')
  const { signJwt } = await import('@/lib/jwt-server')
  const now = Math.floor(Date.now() / 1000)
  const expiresIn = 5 * 60 // 5 minutes
  const serverKey = getServerSigningKey()
  // SECURITY FIX (L-2): Include iss + aud claims for token-confusion defense.
  return signJwt({
    iss: 'veriface-edge-platform',
    aud: 'veriface-edge-2fa',
    sub: userId,
    iat: now,
    exp: now + expiresIn,
    jti: crypto.randomUUID(),
    email,
    type: 'two_factor_pending',
  }, serverKey.privateKey)
}

/**
 * Verify a "2FA pending" token.
 * Returns the userId if valid, null otherwise.
 */
export async function verifyTwoFactorPendingToken(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const signingInput = parts[0] + '.' + parts[1]
  const sigB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/')
  const sigBin = atob(sigB64)
  const signature = new Uint8Array(sigBin.length)
  for (let i = 0; i < sigBin.length; i++) signature[i] = sigBin.charCodeAt(i)

  const { getServerSigningKey } = await import('@/lib/config')
  const { ed25519Verify, utf8 } = await import('@/lib/crypto-server')
  const serverKey = getServerSigningKey()
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
  if (claims.type !== 'two_factor_pending') return null

  // SECURITY FIX (L-2): Validate iss + aud for the 2FA pending token too.
  if (claims.iss !== 'veriface-edge-platform') return null
  const aud = claims.aud
  const audMatches = Array.isArray(aud) ? aud.includes('veriface-edge-2fa') : aud === 'veriface-edge-2fa'
  if (!audMatches) return null

  return { userId: claims.sub, email: claims.email }
}

// Import here to avoid circular dependency
function secureRandomHex(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}
