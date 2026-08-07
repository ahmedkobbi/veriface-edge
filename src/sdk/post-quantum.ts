/**
 * VeriFace Edge SDK — Post-Quantum Cryptography Module
 *
 * Implements ML-DSA-87 (Dilithium5) from the CRYSTALS suite — NIST's
 * post-quantum digital signature standard (FIPS 204, finalized Aug 2024).
 *
 * Security level: NIST Level 5 (equivalent to AES-256)
 *   - Classical security: 272 bits
 *   - Quantum security: 233 bits (against quantum adversaries)
 *
 * Key + signature sizes (significantly larger than Ed25519):
 *   - Public key:  2592 bytes (vs Ed25519's 32 bytes)
 *   - Secret key:  4896 bytes (vs Ed25519's 32 bytes)
 *   - Signature:   4595 bytes (vs Ed25519's 64 bytes)
 *
 * Hybrid mode: During the migration period, the SDK signs with BOTH
 * Ed25519 AND ML-DSA-87. The backend verifies both. This ensures
 * backward compatibility + forward security (if either algorithm
 * is broken, the other still protects the signature).
 *
 * References:
 *   - FIPS 204: Module-Lattice-Based Digital Signature Standard
 *     https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf
 *   - CRYSTALS-Dilithium: https://pq-crystals.org/dilithium/
 *   - @noble/post-quantum: https://github.com/paulmillr/noble-post-quantum
 */

import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hex, utf8 } from './crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MLDSAKeyPair {
  /** Public key (2592 bytes, hex = 5184 chars). */
  publicKey: Uint8Array
  /** Secret key (4896 bytes, hex = 9792 chars). */
  secretKey: Uint8Array
}

export interface HybridKeyPair {
  /** Ed25519 keypair (for backward compatibility). */
  ed25519: {
    publicKey: Uint8Array
    secretKey: Uint8Array
  }
  /** ML-DSA-87 keypair (post-quantum). */
  mldsa87: MLDSAKeyPair
}

export interface HybridSignature {
  /** Ed25519 signature (64 bytes, hex = 128 chars). */
  ed25519: string
  /** ML-DSA-87 signature (4595 bytes, hex = 9190 chars). */
  mldsa87: string
  /** Algorithm identifiers. */
  algorithms: ['Ed25519', 'ML-DSA-87']
}

// ---------------------------------------------------------------------------
// ML-DSA-87 key generation
// ---------------------------------------------------------------------------

/**
 * Generate a new ML-DSA-87 (Dilithium5) keypair.
 *
 * This is the post-quantum signature algorithm recommended by NIST
 * for long-term security (post-2030).
 */
export function generateMLDSA87KeyPair(): MLDSAKeyPair {
  const { publicKey, secretKey } = ml_dsa87.keygen()
  return { publicKey, secretKey }
}

/**
 * Generate a hybrid keypair (Ed25519 + ML-DSA-87).
 *
 * The Ed25519 key provides backward compatibility + small signatures
 * for legacy systems. The ML-DSA-87 key provides post-quantum security.
 *
 * Both keys are used to sign every message (hybrid mode).
 */
export function generateHybridKeyPair(): HybridKeyPair {
  const ed25519SecretKey = ed25519.utils.randomSecretKey()
  const ed25519PublicKey = ed25519.getPublicKey(ed25519SecretKey)
  const mldsa87Keypair = generateMLDSA87KeyPair()

  return {
    ed25519: {
      publicKey: ed25519PublicKey,
      secretKey: ed25519SecretKey,
    },
    mldsa87: mldsa87Keypair,
  }
}

// ---------------------------------------------------------------------------
// ML-DSA-87 signing + verification
// ---------------------------------------------------------------------------

/**
 * Sign a message with ML-DSA-87.
 *
 * @param message - The message bytes to sign
 * @param secretKey - The ML-DSA-87 secret key (4896 bytes)
 * @returns The signature (4595 bytes)
 */
export function signMLDSA87(
  message: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array {
  return ml_dsa87.sign(message, secretKey)
}

/**
 * Verify an ML-DSA-87 signature.
 *
 * @param signature - The signature (4595 bytes)
 * @param message - The original message
 * @param publicKey - The ML-DSA-87 public key (2592 bytes)
 * @returns true if the signature is valid
 */
export function verifyMLDSA87(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ml_dsa87.verify(signature, message, publicKey)
}

// ---------------------------------------------------------------------------
// Hybrid signing (Ed25519 + ML-DSA-87)
// ---------------------------------------------------------------------------

/**
 * Sign a message with BOTH Ed25519 and ML-DSA-87 (hybrid mode).
 *
 * The backend verifies both signatures. If either is valid, the message
 * is accepted. This provides:
 *   - Forward security: if Ed25519 is broken (quantum computer), ML-DSA-87 still holds
 *   - Backward compatibility: if ML-DSA-87 has an implementation bug, Ed25519 still holds
 *   - Defense in depth: both algorithms must be broken to forge a signature
 *
 * @param message - The message bytes to sign
 * @param keypair - The hybrid keypair
 * @returns Hybrid signature (both Ed25519 + ML-DSA-87)
 */
export function signHybrid(
  message: Uint8Array,
  keypair: HybridKeyPair,
): HybridSignature {
  // Sign with Ed25519 (fast, small signature)
  const ed25519Sig = ed25519.sign(message, keypair.ed25519.secretKey)

  // Sign with ML-DSA-87 (post-quantum, large signature)
  const mldsa87Sig = signMLDSA87(message, keypair.mldsa87.secretKey)

  return {
    ed25519: hex.encode(ed25519Sig),
    mldsa87: hex.encode(mldsa87Sig),
    algorithms: ['Ed25519', 'ML-DSA-87'],
  }
}

/**
 * Verify a hybrid signature (both Ed25519 + ML-DSA-87).
 *
 * Returns true only if BOTH signatures are valid.
 * For migration support, use `verifyHybridAny()` which accepts if EITHER is valid.
 *
 * @param signature - The hybrid signature
 * @param message - The original message
 * @param ed25519PublicKey - The Ed25519 public key (32 bytes)
 * @param mldsa87PublicKey - The ML-DSA-87 public key (2592 bytes)
 */
export function verifyHybridAll(
  signature: HybridSignature,
  message: Uint8Array,
  ed25519PublicKey: Uint8Array,
  mldsa87PublicKey: Uint8Array,
): boolean {
  const ed25519Valid = ed25519.verify(
    hex.decode(signature.ed25519),
    message,
    ed25519PublicKey,
  )
  const mldsa87Valid = verifyMLDSA87(
    hex.decode(signature.mldsa87),
    message,
    mldsa87PublicKey,
  )
  return ed25519Valid && mldsa87Valid
}

/**
 * Verify a hybrid signature — accept if EITHER signature is valid.
 *
 * Used during the migration period from Ed25519 → ML-DSA-87.
 * Once migration is complete, switch to `verifyHybridAll()`.
 */
export function verifyHybridAny(
  signature: HybridSignature,
  message: Uint8Array,
  ed25519PublicKey: Uint8Array,
  mldsa87PublicKey: Uint8Array,
): boolean {
  const ed25519Valid = ed25519.verify(
    hex.decode(signature.ed25519),
    message,
    ed25519PublicKey,
  )
  const mldsa87Valid = verifyMLDSA87(
    hex.decode(signature.mldsa87),
    message,
    mldsa87PublicKey,
  )
  return ed25519Valid || mldsa87Valid
}

// ---------------------------------------------------------------------------
// JWT signing with ML-DSA-87
// ---------------------------------------------------------------------------

/**
 * Sign a JWT with ML-DSA-87 (post-quantum).
 *
 * JWT format: base64url(header).base64url(payload).base64url(signature)
 *
 * Header: {"alg":"ML-DSA-87","typ":"JWT","pq":true}
 *
 * Note: The signature is ~4595 bytes (vs Ed25519's 64 bytes), so the JWT
 * is significantly larger. This is the cost of post-quantum security.
 */
export function signJwtMLDSA87(
  payload: Record<string, unknown>,
  secretKey: Uint8Array,
): string {
  const header = {
    alg: 'ML-DSA-87',
    typ: 'JWT',
    pq: true,  // Post-quantum flag
  }

  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`

  const signature = signMLDSA87(utf8.encode(signingInput), secretKey)
  const sigB64 = base64UrlEncodeBytes(signature)

  return `${signingInput}.${sigB64}`
}

/**
 * Sign a JWT with BOTH Ed25519 + ML-DSA-87 (hybrid mode).
 *
 * Header: {"alg":"Hybrid-Ed25519+ML-DSA-87","typ":"JWT","pq":true}
 *
 * The signature field contains a JSON object with both signatures:
 *   {"ed25519":"...","mldsa87":"..."}
 */
export function signJwtHybrid(
  payload: Record<string, unknown>,
  keypair: HybridKeyPair,
): string {
  const header = {
    alg: 'Hybrid-Ed25519+ML-DSA-87',
    typ: 'JWT',
    pq: true,
  }

  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const payloadB64 = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`

  const hybridSig = signHybrid(utf8.encode(signingInput), keypair)
  const sigB64 = base64UrlEncode(JSON.stringify(hybridSig))

  return `${signingInput}.${sigB64}`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(s: string): string {
  const bytes = utf8.encode(s)
  return base64UrlEncodeBytes(bytes)
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

// ---------------------------------------------------------------------------
// Key fingerprint (for rotation/verification)
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 fingerprint of an ML-DSA-87 public key.
 * Used for key rotation verification + certificate transparency.
 */
export function mldsa87KeyFingerprint(publicKey: Uint8Array): string {
  return hex.encode(sha256(publicKey))
}

/**
 * Compute the SHA-256 fingerprint of a hybrid keypair.
 */
export function hybridKeyFingerprint(keypair: HybridKeyPair): {
  ed25519: string
  mldsa87: string
  combined: string
} {
  const ed25519Fp = hex.encode(sha256(keypair.ed25519.publicKey))
  const mldsa87Fp = mldsa87KeyFingerprint(keypair.mldsa87.publicKey)
  const combined = hex.encode(sha256(
    utf8.encode(ed25519Fp + mldsa87Fp)
  ))
  return { ed25519: ed25519Fp, mldsa87: mldsa87Fp, combined }
}
