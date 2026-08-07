/**
 * VeriFace Edge — Backend ZK Proof Verifier (PLONK)
 *
 * Verifies PLONK zk-SNARK proofs submitted by the SDK.
 * The backend NEVER sees the raw embedding — only the proof + public inputs.
 *
 * Verification flow:
 *   1. SDK submits {proof, publicSignals} to /api/session/verify
 *   2. Backend loads the verification key (from disk, ~2KB)
 *   3. Backend verifies the proof using snarkjs.plonk.verify()
 *   4. Backend checks that publicSignals match expected values
 *      (commitment matches enrollment, threshold matches tenant config)
 *   5. If proof is valid, the authentication succeeds
 *
 * Why PLONK (not Groth16)?
 *   - Universal trusted setup: ONE ceremony covers ALL circuits.
 *     No re-ceremony when the circuit changes.
 *   - Updatable SRS: anyone can contribute to the setup, making it
 *     secure even if all but one participant were malicious.
 *   - Industry standard (Aztec, zkSync, Scroll, Polygon zkEVM, Halo2).
 *
 * Performance:
 *   - Verification time: ~15ms (vs Groth16's ~5ms — irrelevant at
 *     human-interaction speeds)
 *   - Verification key size: ~2KB
 *   - Proof size: ~450 bytes (vs Groth16's ~200 bytes — irrelevant
 *     when transmitted alongside a 4.6KB ML-DSA-87 signature)
 *
 * Security:
 *   - PLONK is provably sound under the knowledge-of-exponent assumption
 *     in the algebraic group model (same as Groth16)
 *   - The proof is zero-knowledge: the verifier learns NOTHING about the
 *     private inputs (embedding, nonce) beyond the fact that the proof is valid
 *   - The proof is succinct: verification is constant-time regardless of
 *     the circuit size
 *   - Universal setup eliminates circuit-specific toxic waste — the SRS
 *     is shared across all circuits, so a single MPC ceremony secures
 *     all future circuit versions
 *
 * References:
 *   - PLONK: https://eprint.iacr.org/2019/953
 *   - snarkjs: https://github.com/iden3/snarkjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * PLONK proof payload from the SDK.
 *
 * Unlike Groth16 (which has 3 curve points A, B, C), PLONK proofs are
 * a single opaque blob with multiple polynomial commitments.
 */
export interface ZKProofPayload {
  /** The PLONK proof. */
  proof: {
    protocol: 'plonk'
    curve: 'bn128'
    [key: string]: string | string[] | undefined
  }
  /** Public inputs (commitment + stored hash + threshold). */
  publicSignals: string[]
}

export interface ZKVerificationResult {
  valid: boolean
  /** Error message if verification failed. */
  error?: string
  /** Time taken to verify (ms). */
  durationMs: number
  /** Protocol used (for audit logging). */
  protocol: 'plonk'
}

// ---------------------------------------------------------------------------
// Verification key loading
// ---------------------------------------------------------------------------

let cachedVerificationKey: object | null = null

/**
 * Load the PLONK verification key from disk.
 * The key is ~2KB and is cached in memory after first load.
 *
 * Expected location: /home/z/my-project/zk/verification_key.json
 *
 * To generate the verification key, run the trusted setup:
 *   bash scripts/zk-trusted-setup.sh
 *
 * PLONK advantage: The verification key changes when the circuit changes,
 * but the underlying SRS (Powers of Tau) is universal — no re-ceremony
 * is needed, just re-run `snarkjs plonk setup` with the new circuit.
 */
export function loadVerificationKey(): object {
  if (cachedVerificationKey) return cachedVerificationKey

  const keyPath = join(process.cwd(), 'zk', 'verification_key.json')

  if (!existsSync(keyPath)) {
    logger.warn({ keyPath }, 'ZK verification key not found — ZK proofs will be rejected')
    throw new Error('ZK verification key not found. Run scripts/zk-trusted-setup.sh')
  }

  const keyJson = readFileSync(keyPath, 'utf8')
  cachedVerificationKey = JSON.parse(keyJson)

  // Validate the key is a PLONK verification key (not Groth16)
  const vkey = cachedVerificationKey as { protocol?: string }
  if (vkey.protocol && vkey.protocol !== 'plonk') {
    logger.warn(
      { expected: 'plonk', actual: vkey.protocol },
      'ZK verification key is not PLONK — regeneration needed',
    )
    throw new Error(
      `ZK verification key protocol mismatch: expected 'plonk', got '${vkey.protocol}'. ` +
      'Re-run scripts/zk-trusted-setup.sh to generate a PLONK key.'
    )
  }

  logger.info({ keyPath, protocol: vkey.protocol ?? 'plonk' }, 'ZK verification key loaded (PLONK)')
  return cachedVerificationKey
}

// ---------------------------------------------------------------------------
// Proof verification
// ---------------------------------------------------------------------------

/**
 * Verify a PLONK zk-SNARK proof.
 *
 * @param payload - The proof + public signals from the SDK
 * @param expectedCommitment - The expected Poseidon commitment (from enrollment)
 * @param expectedThreshold - The expected similarity threshold (from tenant config)
 * @returns Verification result
 */
export async function verifyFaceVerificationProof(
  payload: ZKProofPayload,
  expectedCommitment: string,
  expectedThreshold: string,
): Promise<ZKVerificationResult> {
  const startTime = Date.now()

  try {
    // 0. Validate proof protocol
    if (payload.proof.protocol !== 'plonk') {
      return {
        valid: false,
        error: `Invalid proof protocol: expected 'plonk', got '${payload.proof.protocol}'`,
        durationMs: Date.now() - startTime,
        protocol: 'plonk',
      }
    }

    // 1. Load the verification key
    const vkey = loadVerificationKey()

    // 2. Verify the proof using snarkjs PLONK
    const { groth16, plonk } = await import('snarkjs')

    // Use plonk.verify (not groth16.verify)
    const isValid = await plonk.verify(
      vkey,
      payload.publicSignals,
      payload.proof,
    )

    if (!isValid) {
      return {
        valid: false,
        error: 'ZK proof verification failed — proof is invalid',
        durationMs: Date.now() - startTime,
        protocol: 'plonk',
      }
    }

    // 3. Verify that public signals match expected values
    // Public signals format: [commitment[0], commitment[1], stored_hash, threshold]
    const publicSignals = payload.publicSignals
    if (publicSignals.length < 4) {
      return {
        valid: false,
        error: 'Invalid public signals — expected at least 4 elements',
        durationMs: Date.now() - startTime,
        protocol: 'plonk',
      }
    }

    // Check commitment matches (first 2 public signals = commitment)
    const proofCommitment = `${publicSignals[0]}_${publicSignals[1]}`
    if (proofCommitment !== expectedCommitment) {
      return {
        valid: false,
        error: 'Commitment mismatch — proof does not match enrollment',
        durationMs: Date.now() - startTime,
        protocol: 'plonk',
      }
    }

    // Check threshold matches (last public signal)
    const proofThreshold = publicSignals[publicSignals.length - 1]
    if (proofThreshold !== expectedThreshold) {
      return {
        valid: false,
        error: 'Threshold mismatch — proof uses different threshold than tenant config',
        durationMs: Date.now() - startTime,
        protocol: 'plonk',
      }
    }

    logger.debug(
      {
        durationMs: Date.now() - startTime,
        publicSignalsCount: publicSignals.length,
      },
      'PLONK proof verified successfully',
    )

    return {
      valid: true,
      durationMs: Date.now() - startTime,
      protocol: 'plonk',
    }
  } catch (e) {
    return {
      valid: false,
      error: `ZK verification error: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - startTime,
      protocol: 'plonk',
    }
  }
}

/**
 * Check if ZK proof verification is available (key exists + is PLONK).
 */
export function isZKVerificationAvailable(): boolean {
  const keyPath = join(process.cwd(), 'zk', 'verification_key.json')
  if (!existsSync(keyPath)) return false

  try {
    const keyJson = readFileSync(keyPath, 'utf8')
    const vkey = JSON.parse(keyJson)
    return vkey.protocol === 'plonk'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

/**
 * If ZK verification is not available (no key or wrong protocol),
 * fall back to the legacy Pedersen commitment verification.
 * This allows gradual migration from Groth16 → PLONK.
 *
 * In production, ZK verification should ALWAYS be available — the fallback
 * is only for development/testing.
 */
export function getVerificationMode(): 'zk-plonk' | 'pedersen-fallback' {
  return isZKVerificationAvailable() ? 'zk-plonk' : 'pedersen-fallback'
}

// ---------------------------------------------------------------------------
// Backward compatibility (Groth16 → PLONK migration)
// ---------------------------------------------------------------------------

/**
 * Check if a verification key is Groth16 (legacy) or PLONK (current).
 * Used during migration to detect old keys that need regeneration.
 */
export function getVerificationKeyProtocol(): 'plonk' | 'groth16' | 'none' {
  const keyPath = join(process.cwd(), 'zk', 'verification_key.json')
  if (!existsSync(keyPath)) return 'none'

  try {
    const keyJson = readFileSync(keyPath, 'utf8')
    const vkey = JSON.parse(keyJson)
    if (vkey.protocol === 'plonk') return 'plonk'
    if (vkey.protocol === 'groth16') return 'groth16'
    return 'groth16' // Default for old keys without protocol field
  } catch {
    return 'none'
  }
}

/**
 * Migration helper: check if the verification key needs regeneration.
 * Returns true if the key is Groth16 (legacy) or missing.
 */
export function needsKeyRegeneration(): boolean {
  const protocol = getVerificationKeyProtocol()
  return protocol !== 'plonk'
}
