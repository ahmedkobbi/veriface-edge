/**
 * VeriFace Edge — Backend Post-Quantum Signature Verification
 *
 * Verifies ML-DSA-87 (Dilithium5) signatures from the SDK.
 * Supports hybrid mode (Ed25519 + ML-DSA-87) for migration.
 *
 * Security:
 *   - ML-DSA-87 is NIST's post-quantum signature standard (FIPS 204)
 *   - NIST Level 5 security (equivalent to AES-256)
 *   - Quantum-resistant: secure against Shor's algorithm
 *   - Classical security: 272 bits
 *   - Quantum security: 233 bits
 *
 * Migration strategy:
 *   Phase 1 (now): Hybrid mode — SDK signs with both Ed25519 + ML-DSA-87
 *                  Backend accepts if EITHER signature is valid
 *   Phase 2 (6 months): Backend requires BOTH signatures to be valid
 *   Phase 3 (12 months): Backend requires only ML-DSA-87 (Ed25519 deprecated)
 *
 * References:
 *   - FIPS 204: https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf
 *   - @noble/post-quantum: https://github.com/paulmillr/noble-post-quantum
 */

import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hex, utf8 } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HybridSignaturePayload {
  /** Ed25519 signature (64 bytes, hex). */
  ed25519: string
  /** ML-DSA-87 signature (4595 bytes, hex). */
  mldsa87: string
  /** Algorithm identifiers. */
  algorithms: ['Ed25519', 'ML-DSA-87']
}

export interface SignatureVerificationResult {
  valid: boolean
  /** Which signatures were valid. */
  ed25519Valid: boolean
  mldsa87Valid: boolean
  /** Verification mode used. */
  mode: 'hybrid-all' | 'hybrid-any' | 'ed25519-only' | 'mldsa87-only'
  /** Error message if invalid. */
  error?: string
}

export type SignatureMode = 'hybrid-all' | 'hybrid-any' | 'ed25519-only' | 'mldsa87-only'

// ---------------------------------------------------------------------------
// JWT verification (hybrid)
// ---------------------------------------------------------------------------

/**
 * Verify a hybrid JWT (Ed25519 + ML-DSA-87).
 *
 * JWT format: base64url(header).base64url(payload).base64url(signature)
 * where signature is a base64url-encoded JSON object: {"ed25519":"...","mldsa87":"..."}
 *
 * @param jwt - The JWT to verify
 * @param ed25519PublicKey - Ed25519 public key (32 bytes, hex)
 * @param mldsa87PublicKey - ML-DSA-87 public key (2592 bytes, hex)
 * @param mode - Verification mode (hybrid-all = require both, hybrid-any = accept either)
 */
export async function verifyHybridJwt(
  jwt: string,
  ed25519PublicKeyHex: string,
  mldsa87PublicKeyHex: string,
  mode: SignatureMode = 'hybrid-any',
): Promise<SignatureVerificationResult & { payload?: Record<string, unknown> }> {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    return {
      valid: false,
      ed25519Valid: false,
      mldsa87Valid: false,
      mode,
      error: 'Invalid JWT format — expected 3 parts',
    }
  }

  const [headerB64, payloadB64, sigB64] = parts
  const signingInput = `${headerB64}.${payloadB64}`

  // Decode header
  let header: Record<string, unknown>
  try {
    header = JSON.parse(base64UrlDecode(headerB64))
  } catch {
    return {
      valid: false,
      ed25519Valid: false,
      mldsa87Valid: false,
      mode,
      error: 'Invalid JWT header — not valid JSON',
    }
  }

  // Check algorithm
  const alg = header.alg as string
  if (alg !== 'Hybrid-Ed25519+ML-DSA-87' && alg !== 'ML-DSA-87' && alg !== 'EdDSA') {
    return {
      valid: false,
      ed25519Valid: false,
      mldsa87Valid: false,
      mode,
      error: `Unsupported algorithm: ${alg}`,
    }
  }

  // Decode payload
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64))
  } catch {
    return {
      valid: false,
      ed25519Valid: false,
      mldsa87Valid: false,
      mode,
      error: 'Invalid JWT payload — not valid JSON',
    }
  }

  // Decode signature
  let hybridSig: HybridSignaturePayload
  try {
    if (alg === 'EdDSA') {
      // Legacy Ed25519-only JWT (backward compatibility)
      const ed25519Sig = hex.encode(base64UrlDecodeBytes(sigB64))
      hybridSig = {
        ed25519: ed25519Sig,
        mldsa87: '',
        algorithms: ['Ed25519'],
      }
    } else if (alg === 'ML-DSA-87') {
      // Post-quantum only JWT
      const mldsa87Sig = hex.encode(base64UrlDecodeBytes(sigB64))
      hybridSig = {
        ed25519: '',
        mldsa87: mldsa87Sig,
        algorithms: ['ML-DSA-87'],
      }
    } else {
      // Hybrid JWT
      hybridSig = JSON.parse(base64UrlDecode(sigB64))
    }
  } catch {
    return {
      valid: false,
      ed25519Valid: false,
      mldsa87Valid: false,
      mode,
      error: 'Invalid JWT signature — not valid JSON/base64',
    }
  }

  // Verify signatures
  const signingInputBytes = utf8.encode(signingInput)

  let ed25519Valid = false
  let mldsa87Valid = false

  if (hybridSig.ed25519 && ed25519PublicKeyHex) {
    try {
      ed25519Valid = ed25519.verify(
        hex.decode(hybridSig.ed25519),
        signingInputBytes,
        hex.decode(ed25519PublicKeyHex),
      )
    } catch (e) {
      logger.warn({ error: e }, 'Ed25519 verification failed')
    }
  }

  if (hybridSig.mldsa87 && mldsa87PublicKeyHex) {
    try {
      mldsa87Valid = ml_dsa87.verify(
        hex.decode(hybridSig.mldsa87),
        signingInputBytes,
        hex.decode(mldsa87PublicKeyHex),
      )
    } catch (e) {
      logger.warn({ error: e }, 'ML-DSA-87 verification failed')
    }
  }

  // Determine validity based on mode
  let valid: boolean
  switch (mode) {
    case 'hybrid-all':
      valid = ed25519Valid && mldsa87Valid
      break
    case 'hybrid-any':
      valid = ed25519Valid || mldsa87Valid
      break
    case 'ed25519-only':
      valid = ed25519Valid
      break
    case 'mldsa87-only':
      valid = mldsa87Valid
      break
    default:
      valid = ed25519Valid || mldsa87Valid
  }

  return {
    valid,
    ed25519Valid,
    mldsa87Valid,
    mode,
    error: valid ? undefined : `Signature verification failed (ed25519: ${ed25519Valid}, mldsa87: ${mldsa87Valid})`,
    payload: valid ? payload : undefined,
  }
}

// ---------------------------------------------------------------------------
// ML-DSA-87 key utilities
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 fingerprint of an ML-DSA-87 public key.
 * Used for key rotation verification + audit logging.
 */
export function mldsa87KeyFingerprint(publicKeyHex: string): string {
  return hex.encode(sha256(hex.decode(publicKeyHex)))
}

/**
 * Verify that an ML-DSA-87 public key is well-formed.
 * (Basic length check — full validation happens during signature verification.)
 */
export function isValidMLDSA87PublicKey(publicKeyHex: string): boolean {
  // ML-DSA-87 public key is 2592 bytes = 5184 hex chars
  return publicKeyHex.length === 5184 && /^[0-9a-fA-F]+$/.test(publicKeyHex)
}

/**
 * Verify that an ML-DSA-87 signature is well-formed.
 */
export function isValidMLDSA87Signature(sigHex: string): boolean {
  // ML-DSA-87 signature is 4595 bytes = 9190 hex chars
  return sigHex.length === 9190 && /^[0-9a-fA-F]+$/.test(sigHex)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlDecode(s: string): string {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  return atob(b64)
}

function base64UrlDecodeBytes(s: string): Uint8Array {
  const str = base64UrlDecode(s)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Migration status tracking
// ---------------------------------------------------------------------------

/**
 * Get the current post-quantum migration status for a tenant.
 * Used by the admin panel to show migration progress.
 */
export function getMigrationStatus(tenant: {
  signingPubKey: string  // Ed25519
  pqSigningPubKey?: string | null  // ML-DSA-87
}): {
  hasEd25519Key: boolean
  hasMLDSA87Key: boolean
  migrationPhase: 'legacy' | 'hybrid' | 'post-quantum'
  recommendation: string
} {
  const hasEd25519 = !!tenant.signingPubKey
  const hasMLDSA87 = !!tenant.pqSigningPubKey

  let phase: 'legacy' | 'hybrid' | 'post-quantum'
  let recommendation: string

  if (hasEd25519 && !hasMLDSA87) {
    phase = 'legacy'
    recommendation = 'Generate ML-DSA-87 keypair and enable hybrid signing. See docs/POST_QUANTUM_MIGRATION.md'
  } else if (hasEd25519 && hasMLDSA87) {
    phase = 'hybrid'
    recommendation = 'Migration in progress. Once all SDKs support ML-DSA-87, switch to hybrid-all verification mode.'
  } else {
    phase = 'post-quantum'
    recommendation = 'Fully post-quantum. Ed25519 key can be deprecated.'
  }

  return {
    hasEd25519Key: hasEd25519,
    hasMLDSA87Key: hasMLDSA87,
    migrationPhase: phase,
    recommendation,
  }
}
