/**
 * VeriFace Edge — Backend ZK Proof Verifier
 *
 * Verifies Groth16 zk-SNARK proofs submitted by the SDK.
 * The backend NEVER sees the raw embedding — only the proof + public inputs.
 *
 * Verification flow:
 *   1. SDK submits {proof, publicSignals} to /api/session/verify
 *   2. Backend loads the verification key (from disk, ~2KB)
 *   3. Backend verifies the proof using snarkjs.groth16.verify()
 *   4. Backend checks that publicSignals match expected values
 *      (commitment matches enrollment, threshold matches tenant config)
 *   5. If proof is valid, the authentication succeeds
 *
 * Performance:
 *   - Verification time: ~5ms
 *   - Verification key size: ~2KB
 *   - Proof size: ~200 bytes
 *
 * Security:
 *   - Groth16 is provably sound under the knowledge-of-exponent assumption
 *     in the algebraic group model
 *   - The proof is zero-knowledge: the verifier learns NOTHING about the
 *     private inputs (embedding, nonce) beyond the fact that the proof is valid
 *   - The proof is succinct: verification is constant-time regardless of
 *     the circuit size
 *
 * References:
 *   - Groth16: https://eprint.iacr.org/2016/260
 *   - snarkjs: https://github.com/iden3/snarkjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZKProofPayload {
  /** The Groth16 proof (3 curve points: A, B, C). */
  proof: {
    a: [string, string]
    b: [[string, string], [string, string]]
    c: [string, string]
    protocol: 'groth16'
    curve: 'bn128'
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
}

// ---------------------------------------------------------------------------
// Verification key loading
// ---------------------------------------------------------------------------

let cachedVerificationKey: object | null = null

/**
 * Load the Groth16 verification key from disk.
 * The key is ~2KB and is cached in memory after first load.
 *
 * Expected location: /home/z/my-project/zk/verification_key.json
 *
 * To generate the verification key, run the trusted setup:
 *   bash scripts/zk-trusted-setup.sh
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

  logger.info({ keyPath }, 'ZK verification key loaded')
  return cachedVerificationKey
}

// ---------------------------------------------------------------------------
// Proof verification
// ---------------------------------------------------------------------------

/**
 * Verify a Groth16 zk-SNARK proof.
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
    // 1. Load the verification key
    const vkey = loadVerificationKey()

    // 2. Verify the proof using snarkjs
    // Dynamic import — snarkjs is a large module
    const { groth16 } = await import('snarkjs')

    const isValid = await groth16.verify(
      vkey,
      payload.publicSignals,
      payload.proof,
    )

    if (!isValid) {
      return {
        valid: false,
        error: 'ZK proof verification failed — proof is invalid',
        durationMs: Date.now() - startTime,
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
      }
    }

    // Check commitment matches (first 2 public signals = commitment)
    const proofCommitment = `${publicSignals[0]}_${publicSignals[1]}`
    if (proofCommitment !== expectedCommitment) {
      return {
        valid: false,
        error: 'Commitment mismatch — proof does not match enrollment',
        durationMs: Date.now() - startTime,
      }
    }

    // Check threshold matches (last public signal)
    const proofThreshold = publicSignals[publicSignals.length - 1]
    if (proofThreshold !== expectedThreshold) {
      return {
        valid: false,
        error: 'Threshold mismatch — proof uses different threshold than tenant config',
        durationMs: Date.now() - startTime,
      }
    }

    return {
      valid: true,
      durationMs: Date.now() - startTime,
    }
  } catch (e) {
    return {
      valid: false,
      error: `ZK verification error: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - startTime,
    }
  }
}

/**
 * Check if ZK proof verification is available (key exists).
 */
export function isZKVerificationAvailable(): boolean {
  const keyPath = join(process.cwd(), 'zk', 'verification_key.json')
  return existsSync(keyPath)
}

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

/**
 * If ZK verification is not available (no key), fall back to the legacy
 * Pedersen commitment verification. This allows gradual migration.
 *
 * In production, ZK verification should ALWAYS be available — the fallback
 * is only for development/testing.
 */
export function getVerificationMode(): 'zk' | 'pedersen-fallback' {
  return isZKVerificationAvailable() ? 'zk' : 'pedersen-fallback'
}
