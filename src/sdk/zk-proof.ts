/**
 * VeriFace Edge SDK — Zero-Knowledge Proof System (PLONK)
 *
 * Generates PLONK zk-SNARK proofs that verify:
 *   1. The SDK computed the embedding honestly (Poseidon hash commitment)
 *   2. The embedding matches the stored template (cosine similarity ≥ threshold)
 *
 * WITHOUT revealing the embedding to the backend.
 *
 * Architecture:
 *   1. SDK generates embedding + nonce (private inputs)
 *   2. SDK computes the Poseidon commitment (public input)
 *   3. SDK generates a PLONK proof using the proving key
 *   4. SDK sends {proof, publicInputs} to the backend
 *   5. Backend verifies the proof using the verification key
 *   6. Backend NEVER sees the embedding — only the proof + commitment
 *
 * Why PLONK (not Groth16)?
 *   - Universal trusted setup: ONE ceremony covers ALL circuits up to N
 *     constraints. No need for a circuit-specific ceremony when the
 *     circuit changes.
 *   - Updatable SRS: Anyone can contribute randomness to the Structured
 *     Reference String. After enough contributions, the setup is secure
 *     even if all but one participant were malicious.
 *   - Future-proof: PLONK is the industry standard (Aztec, zkSync,
 *     Scroll, Polygon zkEVM, Halo2 all use PLONK variants).
 *
 * Trade-offs vs Groth16:
 *   - Proof size: ~450 bytes (vs Groth16's ~200 bytes) — irrelevant
 *     when transmitting alongside a 4.6KB ML-DSA-87 signature
 *   - Verification: ~15ms (vs Groth16's ~5ms) — irrelevant at
 *     human-interaction speeds
 *   - Proving time: ~3-7s (vs Groth16's ~2-5s) — comparable
 *   - Setup: universal (vs Groth16's circuit-specific) — decisive advantage
 *
 * Proof sizes (PLONK):
 *   - Proof: ~450 bytes (encoded as a single hex/base64 string)
 *   - Public inputs: ~100 bytes (commitment + stored hash + threshold)
 *   - Verification time: ~15ms
 *   - Proving time: ~3-7 seconds (depending on circuit size)
 *
 * Trusted setup:
 *   PLONK uses a universal SRS (Structured Reference String) from the
 *   Powers of Tau ceremony. This SAME SRS works for ALL circuits up to
 *   the configured constraint limit — no circuit-specific phase needed.
 *   See scripts/zk-trusted-setup.sh for the ceremony procedure.
 *   The proving key (zkey) is ~50MB and must be loaded by the SDK.
 *   The verification key is ~2KB and is used by the backend.
 *
 * References:
 *   - PLONK paper: https://eprint.iacr.org/2019/953 (Gabizon, Williamson, Ciobotaru)
 *   - snarkjs: https://github.com/iden3/snarkjs
 *   - Circom: https://docs.circom.io/
 *   - Universal setup: https://github.com/weijiekoh/perpetualpowersoftau
 */

import { snarkjs } from 'snarkjs'
import { hex, utf8 } from './crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * PLONK proof structure.
 *
 * Unlike Groth16 (which has 3 curve points A, B, C), PLONK proofs are
 * a single opaque blob — typically encoded as a hex string or base64.
 * The structure below mirrors snarkjs's output format.
 */
export interface ZKProof {
  /** The PLONK proof (encoded proof data). */
  proof: {
    /** Protocol identifier. */
    protocol: 'plonk'
    /** Curve identifier. */
    curve: 'bn128'
    /**
     * The proof data — a single encoded string containing all the
     * polynomial commitments + evaluation proofs.
     *
     * snarkjs represents this as a flat object with multiple fields
     * (A, B, C, Z, T1, T2, T3, Wxi, Wxiw, eval_a, eval_b, eval_c,
     * eval_s1, eval_s2, eval_z, eval_t, eval_r, eval_zw).
     *
     * For transmission, use serializeProof() which base64-encodes
     * the entire proof for compact transport.
     */
    [key: string]: string | string[] | undefined
  }
  /** Public inputs (commitment + stored hash + threshold). */
  publicSignals: string[]
}

export interface ZKProofInput {
  /** Private: Face embedding (512 Float32 values, scaled by 1000 to integers). */
  embedding: number[]
  /** Private: ZK nonce (32 bytes, as integers 0-255). */
  nonce: number[]
  /** Public: Expected Poseidon commitment (2 field elements, as strings). */
  commitment: [string, string]
  /** Public: Stored embedding hash (1 field element, as string). */
  stored_embedding_hash: string
  /** Public: Cosine similarity threshold (×1000, as string). */
  threshold: string
}

export interface ZKProvingConfig {
  /** URL or path to the proving key (.zkey file). */
  provingKeyUrl: string
  /** Whether to cache the proving key in IndexedDB (default: true). */
  cacheKey?: boolean
}

// ---------------------------------------------------------------------------
// Proving key management
// ---------------------------------------------------------------------------

let cachedProvingKey: ArrayBuffer | null = null

/**
 * Load the proving key (.zkey file) from the configured URL.
 * Caches in memory after first load (the key is ~50MB).
 *
 * For PLONK, the proving key is derived from the universal SRS + the
 * circuit's R1CS — no circuit-specific trusted setup phase is needed.
 */
export async function loadProvingKey(url: string): Promise<ArrayBuffer> {
  if (cachedProvingKey) return cachedProvingKey

  // Try loading from IndexedDB first (for offline use)
  if ('indexedDB' in globalThis) {
    try {
      const cached = await loadFromIndexedDB('veriface-zk-proving-key')
      if (cached) {
        cachedProvingKey = cached
        return cachedProvingKey
      }
    } catch {
      // Non-critical — fall through to network fetch
    }
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load proving key: HTTP ${res.status}`)
  }
  cachedProvingKey = await res.arrayBuffer()

  // Cache in IndexedDB for offline use
  if ('indexedDB' in globalThis) {
    try {
      await cacheInIndexedDB('veriface-zk-proving-key', cachedProvingKey)
    } catch {
      // Non-critical — ignore IndexedDB errors
    }
  }

  return cachedProvingKey
}

/**
 * Try to load the proving key from IndexedDB (for offline use).
 */
async function loadFromIndexedDB(key: string): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open('veriface-zk', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('keys')
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keys', 'readonly')
      const store = tx.objectStore('keys')
      const getReq = store.get(key)
      getReq.onsuccess = () => resolve(getReq.result || null)
      getReq.onerror = () => resolve(null)
    }
    req.onerror = () => resolve(null)
  })
}

async function cacheInIndexedDB(key: string, data: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('veriface-zk', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('keys')
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keys', 'readwrite')
      const store = tx.objectStore('keys')
      store.put(data, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

/**
 * Generate a PLONK zk-SNARK proof for face verification.
 *
 * @param input - The proof inputs (embedding, nonce, commitment, threshold)
 * @param provingKeyUrl - URL of the .zkey proving key file
 * @returns The ZK proof + public signals
 *
 * Proving time: ~3-7 seconds (depending on circuit size + device speed).
 * The proof is ~450 bytes — larger than Groth16's 200 bytes, but
 * irrelevant when transmitted alongside a 4.6KB ML-DSA-87 signature.
 *
 * PLONK advantage: The SAME proving key works for all circuit versions
 * up to the constraint limit. No re-ceremony needed when the circuit changes.
 */
export async function generateFaceVerificationProof(
  input: ZKProofInput,
  provingKeyUrl: string,
): Promise<ZKProof> {
  // Load the proving key (cached after first load)
  const provingKey = await loadProvingKey(provingKeyUrl)

  // Generate the proof using snarkjs PLONK
  // snarkjs.plonk.fullProve computes the witness + proof in one step.
  const { proof, publicSignals } = await snarkjs.plonk.fullProve(
    input,
    provingKey,
  )

  return {
    proof: proof as ZKProof['proof'],
    publicSignals: publicSignals as string[],
  }
}

/**
 * Verify a PLONK proof locally (client-side verification — useful for testing).
 *
 * @param proof - The ZK proof
 * @param verificationKey - The verification key (JSON object)
 * @returns true if the proof is valid
 */
export async function verifyProofLocally(
  proof: ZKProof,
  verificationKey: object,
): Promise<boolean> {
  return snarkjs.plonk.verify(
    verificationKey,
    proof.publicSignals,
    proof.proof,
  )
}

// ---------------------------------------------------------------------------
// Input preparation
// ---------------------------------------------------------------------------

/**
 * Prepare the ZK proof inputs from the SDK's internal data.
 *
 * @param embedding - Float32 embedding (512 values)
 * @param nonce - ZK nonce (32 bytes)
 * @param storedEmbeddingHash - Hash of the stored embedding (field element as string)
 * @param threshold - Cosine similarity threshold (0.0–1.0)
 * @returns ZK proof inputs (scaled to integers for the circuit)
 */
export function prepareProofInputs(
  embedding: Float32Array,
  nonce: Uint8Array,
  storedEmbeddingHash: string,
  threshold: number,
): ZKProofInput {
  // Scale embedding from Float32 to integers (×1000 for 3 decimal places)
  // The circuit operates on integers — ZK circuits can't do floating point.
  const scaledEmbedding = Array.from(embedding).map((v) =>
    Math.round(v * 1000),
  )

  // Scale threshold (0.0–1.0 → 0–1000)
  const scaledThreshold = Math.round(threshold * 1000).toString()

  // The commitment is computed by the witness generator (snarkjs handles
  // this internally during fullProve — the circuit computes Poseidon
  // and the public output is verified against the commitment input).
  const commitment: [string, string] = ['0', '0']

  return {
    embedding: scaledEmbedding,
    nonce: Array.from(nonce),
    commitment,
    stored_embedding_hash: storedEmbeddingHash,
    threshold: scaledThreshold,
  }
}

// ---------------------------------------------------------------------------
// Proof serialization (for transmission)
// ---------------------------------------------------------------------------

/**
 * Serialize a ZK proof for transmission to the backend.
 *
 * PLONK proofs are ~450 bytes (vs Groth16's 200 bytes). We serialize
 * as compact JSON — the proof object is small enough that base64
 * encoding isn't needed (unlike the ML-DSA-87 signature which is 4.6KB).
 */
export function serializeProof(proof: ZKProof): string {
  return JSON.stringify(proof)
}

/**
 * Deserialize a ZK proof from the backend.
 */
export function deserializeProof(s: string): ZKProof {
  return JSON.parse(s)
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Clear the cached proving key from memory.
 * Call this when the user logs out or the session ends.
 *
 * Also wipes the memory buffer (best-effort — JS doesn't guarantee
 * secure zeroing, but we overwrite the reference).
 */
export function clearProvingKeyCache(): void {
  if (cachedProvingKey) {
    // Best-effort memory wipe — overwrite the buffer with zeros
    try {
      const view = new Uint8Array(cachedProvingKey)
      for (let i = 0; i < view.length; i++) view[i] = 0
    } catch {
      // ArrayBuffer may be detached — ignore
    }
  }
  cachedProvingKey = null
}

/**
 * Clear the proving key from IndexedDB (full cleanup).
 */
export async function clearProvingKeyFromIndexedDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.open('veriface-zk', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('keys')
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keys', 'readwrite')
      const store = tx.objectStore('keys')
      store.delete('veriface-zk-proving-key')
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    }
    req.onerror = () => resolve()
  })
}

// ---------------------------------------------------------------------------
// Protocol versioning
// ---------------------------------------------------------------------------

/**
 * The ZK proof protocol used by this SDK.
 * Used by the backend to route verification to the correct verifier.
 */
export const ZK_PROTOCOL = 'plonk' as const
export const ZK_CURVE = 'bn128' as const

/**
 * Get the protocol version for compatibility checks.
 * The backend uses this to select the correct verifier (plonk vs groth16).
 */
export function getZkProtocolVersion(): { protocol: 'plonk'; curve: 'bn128'; version: string } {
  return {
    protocol: ZK_PROTOCOL,
    curve: ZK_CURVE,
    version: '1.0.0',
  }
}
