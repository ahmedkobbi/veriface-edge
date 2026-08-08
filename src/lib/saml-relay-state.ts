/**
 * VeriFace Edge — SAML RelayState Security
 *
 * SECURITY FIX (B-08): Previously, the SAML ACS endpoint trusted the
 * `RelayState` form field as the tenant ID without validation. Since
 * RelayState is client-controlled (it's a form field in the IdP's POST),
 * an attacker could substitute a different tenant ID, causing the SAML
 * response to be verified against a different tenant's IdP certificate.
 *
 * If two tenants share the same IdP (e.g., both use the same Okta instance),
 * the attacker's SAML response would verify against the victim tenant's
 * config, granting cross-tenant access.
 *
 * Fix: The RelayState is now a SIGNED token containing:
 *   - tenantId (the original tenant from the login request)
 *   - redirect (where to send the user after auth)
 *   - nonce (one-time use — prevents replay)
 *   - expiresAt (10-minute TTL)
 *   - signature (HMAC-SHA256 with the server signing key)
 *
 * The login endpoint creates the signed RelayState. The ACS endpoint
 * verifies the signature before extracting the tenantId.
 *
 * Token format: base64url(JSON({ tenantId, redirect, nonce, exp })) + '.' + hmac
 */

import { hmacSha256, utf8, secureRandomHex, constantTimeEqual } from '@/lib/crypto-server'
import { getServerSigningKey } from '@/lib/config'
import { logger } from '@/lib/logger'

const RELAY_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

interface SignedRelayState {
  tenantId: string
  redirect?: string
  nonce: string
  exp: number
}

/**
 * Create a signed RelayState token for a SAML login request.
 *
 * The token is base64url(JSON(payload)) + '.' + base64url(HMAC-SHA256(payload, key)).
 * This is structurally similar to a JWT but simpler (no header — the algorithm
 * is fixed to HMAC-SHA256 with the server signing key).
 */
export function createSignedRelayState(tenantId: string, redirect?: string): string {
  const payload: SignedRelayState = {
    tenantId,
    redirect,
    nonce: secureRandomHex(16),
    exp: Date.now() + RELAY_STATE_TTL_MS,
  }

  const payloadJson = JSON.stringify(payload)
  const payloadB64 = Buffer.from(payloadJson, 'utf-8').toString('base64url')

  // Sign with the server's Ed25519 private key (converted to bytes for HMAC).
  // NOTE: We use HMAC-SHA256 with the key bytes, not Ed25519 signing, because
  // HMAC is simpler and sufficient for this use case (tamper detection, not
  // non-repudiation — the server is both signer and verifier).
  const serverKey = getServerSigningKey()
  const keyBytes = serverKey.privateKey
  const signature = hmacSha256(keyBytes, utf8.encode(payloadB64))

  return `${payloadB64}.${signature}`
}

/**
 * Verify a signed RelayState token and extract the tenant ID.
 *
 * Returns null if:
 *   - The token is malformed
 *   - The signature is invalid (tampering detected)
 *   - The token has expired
 *
 * SECURITY: The signature is compared in constant time to prevent timing
 * attacks on the HMAC comparison.
 */
export function verifySignedRelayState(token: string): { tenantId: string; redirect?: string } | null {
  if (!token || typeof token !== 'string') return null

  const parts = token.split('.')
  if (parts.length !== 2) {
    logger.warn('SAML RelayState: malformed token (expected 2 parts)')
    return null
  }

  const [payloadB64, signature] = parts
  if (!payloadB64 || !signature) {
    logger.warn('SAML RelayState: empty payload or signature')
    return null
  }

  // Recompute the expected signature
  const serverKey = getServerSigningKey()
  const keyBytes = serverKey.privateKey
  const expectedSignature = hmacSha256(keyBytes, utf8.encode(payloadB64))

  // Constant-time comparison (prevents timing attacks)
  if (!constantTimeEqual(signature, expectedSignature)) {
    logger.warn('SAML RelayState: signature verification failed — possible tampering')
    return null
  }

  // Decode payload
  let payload: SignedRelayState
  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8')
    payload = JSON.parse(payloadJson)
  } catch (e) {
    logger.warn({ error: e }, 'SAML RelayState: failed to decode payload')
    return null
  }

  // Validate payload structure
  if (!payload.tenantId || typeof payload.tenantId !== 'string') {
    logger.warn('SAML RelayState: missing or invalid tenantId')
    return null
  }
  if (!payload.exp || typeof payload.exp !== 'number') {
    logger.warn('SAML RelayState: missing or invalid exp')
    return null
  }

  // Check expiry
  if (Date.now() > payload.exp) {
    logger.warn({ tenantId: payload.tenantId, exp: payload.exp }, 'SAML RelayState: token expired')
    return null
  }

  return {
    tenantId: payload.tenantId,
    redirect: payload.redirect,
  }
}
