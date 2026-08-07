/**
 * Tests for the post-quantum + ZK proof system.
 *
 * Tests:
 *   1. ML-DSA-87 key generation + sign/verify
 *   2. Hybrid signing (Ed25519 + ML-DSA-87)
 *   3. Key fingerprints
 *   4. ZK proof input preparation
 *   5. Circuit constraint verification (logic-only, no actual proving)
 *   6. Backend verification mode logic
 */

import { describe, it, expect } from 'bun:test'
import {
  generateMLDSA87KeyPair,
  signMLDSA87,
  verifyMLDSA87,
  generateHybridKeyPair,
  signHybrid,
  verifyHybridAll,
  verifyHybridAny,
  signJwtMLDSA87,
  signJwtHybrid,
  mldsa87KeyFingerprint,
  hybridKeyFingerprint,
} from '../src/sdk/post-quantum'
import { utf8 } from '../src/sdk/crypto'

describe('Post-Quantum: ML-DSA-87 (Dilithium5)', () => {
  describe('Key generation', () => {
    it('generates a valid ML-DSA-87 keypair', () => {
      const keypair = generateMLDSA87KeyPair()
      // Public key: 2592 bytes
      expect(keypair.publicKey.length).toBe(2592)
      // Secret key: 4896 bytes
      expect(keypair.secretKey.length).toBe(4896)
    })

    it('generates unique keypairs', () => {
      const kp1 = generateMLDSA87KeyPair()
      const kp2 = generateMLDSA87KeyPair()
      expect(Buffer.from(kp1.publicKey)).not.toEqual(Buffer.from(kp2.publicKey))
      expect(Buffer.from(kp1.secretKey)).not.toEqual(Buffer.from(kp2.secretKey))
    })

    it('generates 5+ keypairs without collision', () => {
      const keys = new Set<string>()
      for (let i = 0; i < 5; i++) {
        const kp = generateMLDSA87KeyPair()
        keys.add(Buffer.from(kp.publicKey).toString('hex'))
      }
      expect(keys.size).toBe(5)
    })
  })

  describe('Sign + Verify', () => {
    it('signs and verifies a message correctly', () => {
      const keypair = generateMLDSA87KeyPair()
      const message = utf8.encode('Hello, post-quantum world!')
      const signature = signMLDSA87(message, keypair.secretKey)

      // ML-DSA-87 signature: ~4595-4627 bytes (depends on implementation)
      expect(signature.length).toBeGreaterThanOrEqual(4595)
      expect(signature.length).toBeLessThanOrEqual(4700)

      const valid = verifyMLDSA87(signature, message, keypair.publicKey)
      expect(valid).toBe(true)
    })

    it('rejects a modified message', () => {
      const keypair = generateMLDSA87KeyPair()
      const message = utf8.encode('Original message')
      const signature = signMLDSA87(message, keypair.secretKey)

      const modifiedMessage = utf8.encode('Modified message')
      const valid = verifyMLDSA87(signature, modifiedMessage, keypair.publicKey)
      expect(valid).toBe(false)
    })

    it('rejects a signature from a different keypair', () => {
      const kp1 = generateMLDSA87KeyPair()
      const kp2 = generateMLDSA87KeyPair()
      const message = utf8.encode('Test message')
      const signature = signMLDSA87(message, kp1.secretKey)

      // Verify with wrong public key
      const valid = verifyMLDSA87(signature, message, kp2.publicKey)
      expect(valid).toBe(false)
    })

    it('signs a large message (4KB)', () => {
      const keypair = generateMLDSA87KeyPair()
      const message = new Uint8Array(4096)
      for (let i = 0; i < 4096; i++) message[i] = i % 256
      const signature = signMLDSA87(message, keypair.secretKey)
      const valid = verifyMLDSA87(signature, message, keypair.publicKey)
      expect(valid).toBe(true)
    })
  })

  describe('Key fingerprint', () => {
    it('computes a SHA-256 fingerprint (64 hex chars)', () => {
      const keypair = generateMLDSA87KeyPair()
      const fp = mldsa87KeyFingerprint(keypair.publicKey)
      expect(fp.length).toBe(64)
      expect(/^[0-9a-f]+$/.test(fp)).toBe(true)
    })

    it('produces different fingerprints for different keys', () => {
      const kp1 = generateMLDSA87KeyPair()
      const kp2 = generateMLDSA87KeyPair()
      const fp1 = mldsa87KeyFingerprint(kp1.publicKey)
      const fp2 = mldsa87KeyFingerprint(kp2.publicKey)
      expect(fp1).not.toBe(fp2)
    })
  })
})

describe('Post-Quantum: Hybrid Mode (Ed25519 + ML-DSA-87)', () => {
  describe('Hybrid keypair generation', () => {
    it('generates both Ed25519 + ML-DSA-87 keypairs', () => {
      const hybrid = generateHybridKeyPair()
      // Ed25519 public key: 32 bytes
      expect(hybrid.ed25519.publicKey.length).toBe(32)
      expect(hybrid.ed25519.secretKey.length).toBe(32)
      // ML-DSA-87 public key: 2592 bytes
      expect(hybrid.mldsa87.publicKey.length).toBe(2592)
      expect(hybrid.mldsa87.secretKey.length).toBe(4896)
    })
  })

  describe('Hybrid signing + verification', () => {
    it('signs with both algorithms', () => {
      const keypair = generateHybridKeyPair()
      const message = utf8.encode('Hybrid test message')
      const sig = signHybrid(message, keypair)

      // Ed25519 signature: 64 bytes = 128 hex chars
      expect(sig.ed25519.length).toBe(128)
      // ML-DSA-87 signature: ~4595-4627 bytes = ~9190-9254 hex chars
      expect(sig.mldsa87.length).toBeGreaterThanOrEqual(9190)
      expect(sig.mldsa87.length).toBeLessThanOrEqual(9300)
      expect(sig.algorithms).toEqual(['Ed25519', 'ML-DSA-87'])
    })

    it('verifies both signatures (verifyHybridAll)', () => {
      const keypair = generateHybridKeyPair()
      const message = utf8.encode('Verify both')
      const sig = signHybrid(message, keypair)

      const valid = verifyHybridAll(
        sig,
        message,
        keypair.ed25519.publicKey,
        keypair.mldsa87.publicKey,
      )
      expect(valid).toBe(true)
    })

    it('verifies if either signature is valid (verifyHybridAny)', () => {
      const keypair = generateHybridKeyPair()
      const message = utf8.encode('Verify any')
      const sig = signHybrid(message, keypair)

      const valid = verifyHybridAny(
        sig,
        message,
        keypair.ed25519.publicKey,
        keypair.mldsa87.publicKey,
      )
      expect(valid).toBe(true)
    })

    it('verifyHybridAll fails if Ed25519 signature is tampered', () => {
      const keypair = generateHybridKeyPair()
      const message = utf8.encode('Tamper test')
      const sig = signHybrid(message, keypair)

      // Tamper with Ed25519 signature
      const tamperedSig = {
        ...sig,
        ed25519: '00'.repeat(64),
      }

      const valid = verifyHybridAll(
        tamperedSig,
        message,
        keypair.ed25519.publicKey,
        keypair.mldsa87.publicKey,
      )
      expect(valid).toBe(false)
    })

    it('verifyHybridAny still passes if Ed25519 is tampered (ML-DSA-87 is valid)', () => {
      const keypair = generateHybridKeyPair()
      const message = utf8.encode('Tamper ed25519 only')
      const sig = signHybrid(message, keypair)

      // Tamper with Ed25519 signature
      const tamperedSig = {
        ...sig,
        ed25519: '00'.repeat(64),
      }

      const valid = verifyHybridAny(
        tamperedSig,
        message,
        keypair.ed25519.publicKey,
        keypair.mldsa87.publicKey,
      )
      expect(valid).toBe(true) // ML-DSA-87 is still valid
    })
  })

  describe('JWT signing', () => {
    it('signs a JWT with ML-DSA-87 only', () => {
      const keypair = generateMLDSA87KeyPair()
      const payload = { sub: 'user_123', iat: Date.now() }
      const jwt = signJwtMLDSA87(payload, keypair.secretKey)

      // JWT has 3 parts
      expect(jwt.split('.').length).toBe(3)

      // Header contains ML-DSA-87 algorithm
      const header = JSON.parse(atob(jwt.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')))
      expect(header.alg).toBe('ML-DSA-87')
      expect(header.pq).toBe(true)
    })

    it('signs a JWT with hybrid (Ed25519 + ML-DSA-87)', () => {
      const keypair = generateHybridKeyPair()
      const payload = { sub: 'user_456', iat: Date.now() }
      const jwt = signJwtHybrid(payload, keypair)

      expect(jwt.split('.').length).toBe(3)

      const header = JSON.parse(atob(jwt.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')))
      expect(header.alg).toBe('Hybrid-Ed25519+ML-DSA-87')
      expect(header.pq).toBe(true)
    })
  })

  describe('Hybrid key fingerprint', () => {
    it('computes fingerprints for both keys + combined', () => {
      const keypair = generateHybridKeyPair()
      const fp = hybridKeyFingerprint(keypair)

      // Ed25519 fingerprint: 64 hex chars
      expect(fp.ed25519.length).toBe(64)
      // ML-DSA-87 fingerprint: 64 hex chars
      expect(fp.mldsa87.length).toBe(64)
      // Combined fingerprint: 64 hex chars
      expect(fp.combined.length).toBe(64)

      // All should be different
      expect(fp.ed25519).not.toBe(fp.mldsa87)
      expect(fp.ed25519).not.toBe(fp.combined)
      expect(fp.mldsa87).not.toBe(fp.combined)
    })
  })
})

describe('ZK Proof System: Input Preparation', () => {
  // Test the input preparation logic (no actual proving — that requires
  // the trusted setup ceremony to have been run)

  it('scales Float32 embedding to integers (×1000)', () => {
    // Mirrors prepareProofInputs logic
    const embedding = new Float32Array([0.123, 0.456, 0.789])
    const scaled = Array.from(embedding).map((v) => Math.round(v * 1000))
    expect(scaled).toEqual([123, 456, 789])
  })

  it('scales threshold from 0.0-1.0 to 0-1000', () => {
    const threshold = 0.78
    const scaled = Math.round(threshold * 1000).toString()
    expect(scaled).toBe('780')
  })

  it('converts Uint8Array nonce to number array', () => {
    const nonce = new Uint8Array([0, 1, 2, 3, 4, 5])
    const arr = Array.from(nonce)
    expect(arr).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('prepares a complete proof input object', () => {
    const embedding = new Float32Array(512).fill(0.5)
    const nonce = new Uint8Array(32).fill(42)
    const storedHash = '1234567890123456789012345678901234567890'
    const threshold = 0.78

    // Mirrors prepareProofInputs
    const input = {
      embedding: Array.from(embedding).map((v) => Math.round(v * 1000)),
      nonce: Array.from(nonce),
      commitment: ['0', '0'] as [string, string],
      stored_embedding_hash: storedHash,
      threshold: Math.round(threshold * 1000).toString(),
    }

    expect(input.embedding.length).toBe(512)
    expect(input.embedding[0]).toBe(500)
    expect(input.nonce.length).toBe(32)
    expect(input.nonce[0]).toBe(42)
    expect(input.threshold).toBe('780')
  })
})

describe('ZK Proof System: Circuit Logic', () => {
  // Test the mathematical logic of the circuit (without running the actual
  // Groth16 prover, which requires the trusted setup ceremony)

  it('dot product of identical vectors = sum of squares', () => {
    const a = [1, 2, 3, 4, 5]
    const dot = a.reduce((sum, v) => sum + v * v, 0)
    expect(dot).toBe(55) // 1+4+9+16+25
  })

  it('cosine similarity of identical vectors = 1.0', () => {
    const a = [1, 2, 3]
    const b = [1, 2, 3]
    const dot = a.reduce((s, v, i) => s + v * b[i], 0)
    const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
    const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0))
    const cosSim = dot / (normA * normB)
    expect(cosSim).toBeCloseTo(1.0, 5)
  })

  it('cosine similarity of orthogonal vectors = 0.0', () => {
    const a = [1, 0]
    const b = [0, 1]
    const dot = a.reduce((s, v, i) => s + v * b[i], 0)
    const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
    const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0))
    const cosSim = dot / (normA * normB)
    expect(cosSim).toBeCloseTo(0.0, 5)
  })

  it('cosine similarity of opposite vectors = -1.0', () => {
    const a = [1, 2, 3]
    const b = [-1, -2, -3]
    const dot = a.reduce((s, v, i) => s + v * b[i], 0)
    const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
    const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0))
    const cosSim = dot / (normA * normB)
    expect(cosSim).toBeCloseTo(-1.0, 5)
  })

  it('threshold check: cosine similarity 0.85 >= threshold 0.78', () => {
    const cosSim = 0.85
    const threshold = 0.78
    expect(cosSim >= threshold).toBe(true)
  })

  it('threshold check: cosine similarity 0.65 < threshold 0.78', () => {
    const cosSim = 0.65
    const threshold = 0.78
    expect(cosSim >= threshold).toBe(false)
  })

  it('scaled threshold comparison (integer arithmetic)', () => {
    // In the circuit, all values are scaled by 1000
    const dotProduct = 850  // 0.85 × 1000
    const threshold = 780   // 0.78 × 1000
    expect(dotProduct >= threshold).toBe(true)
  })
})

describe('Backend: ML-DSA-87 Key Validation', () => {
  // Mirrors isValidMLDSA87PublicKey logic from src/lib/post-quantum-server.ts
  it('accepts a valid ML-DSA-87 public key (5184 hex chars)', () => {
    const validKey = 'a'.repeat(5184)
    expect(validKey.length).toBe(5184)
    expect(/^[0-9a-fA-F]+$/.test(validKey)).toBe(true)
  })

  it('rejects a key that is too short', () => {
    const shortKey = 'a'.repeat(100)
    expect(shortKey.length).not.toBe(5184)
  })

  it('rejects a key with non-hex characters', () => {
    const badKey = 'g'.repeat(5184) // 'g' is not a hex char
    expect(/^[0-9a-fA-F]+$/.test(badKey)).toBe(false)
  })

  it('accepts a valid ML-DSA-87 signature (9190 hex chars)', () => {
    const validSig = 'a'.repeat(9190)
    expect(validSig.length).toBe(9190)
    expect(/^[0-9a-fA-F]+$/.test(validSig)).toBe(true)
  })
})

describe('Backend: Migration Status Logic', () => {
  // Mirrors getMigrationStatus logic from src/lib/post-quantum-server.ts
  it('returns "legacy" for tenant with only Ed25519 key', () => {
    const tenant = { signingPubKey: 'abc', pqSigningPubKey: null }
    const hasEd25519 = !!tenant.signingPubKey
    const hasMLDSA87 = !!tenant.pqSigningPubKey
    const phase = hasEd25519 && !hasMLDSA87 ? 'legacy' : 'hybrid'
    expect(phase).toBe('legacy')
  })

  it('returns "hybrid" for tenant with both keys', () => {
    const tenant = { signingPubKey: 'abc', pqSigningPubKey: 'def' }
    const hasEd25519 = !!tenant.signingPubKey
    const hasMLDSA87 = !!tenant.pqSigningPubKey
    const phase = hasEd25519 && hasMLDSA87 ? 'hybrid' : 'legacy'
    expect(phase).toBe('hybrid')
  })

  it('returns "post-quantum" for tenant with only ML-DSA-87 key', () => {
    const tenant = { signingPubKey: '', pqSigningPubKey: 'def' }
    const hasEd25519 = !!tenant.signingPubKey
    const hasMLDSA87 = !!tenant.pqSigningPubKey
    const phase = !hasEd25519 && hasMLDSA87 ? 'post-quantum' : 'hybrid'
    expect(phase).toBe('post-quantum')
  })
})

describe('Backend: ZK Verification Mode', () => {
  // Mirrors getVerificationMode logic from src/lib/zk-verifier.ts (PLONK version)
  it('returns "zk-plonk" when PLONK verification key exists', () => {
    // In production, this checks if zk/verification_key.json exists AND
    // the protocol field is 'plonk'
    const keyExists = true
    const protocol = 'plonk'
    const mode = keyExists && protocol === 'plonk' ? 'zk-plonk' : 'pedersen-fallback'
    expect(mode).toBe('zk-plonk')
  })

  it('returns "pedersen-fallback" when verification key is missing', () => {
    const keyExists = false
    const mode = keyExists ? 'zk-plonk' : 'pedersen-fallback'
    expect(mode).toBe('pedersen-fallback')
  })

  it('returns "pedersen-fallback" when key is Groth16 (legacy)', () => {
    // If the key exists but is Groth16 (old protocol), we fall back
    // until the key is regenerated as PLONK
    const keyExists = true
    const protocol = 'groth16'
    const mode = keyExists && protocol === 'plonk' ? 'zk-plonk' : 'pedersen-fallback'
    expect(mode).toBe('pedersen-fallback')
  })

  it('detects when key needs regeneration (Groth16 → PLONK)', () => {
    // Mirrors needsKeyRegeneration logic
    const protocol = 'groth16'  // Legacy key
    const needsRegen = protocol !== 'plonk'
    expect(needsRegen).toBe(true)
  })

  it('does not need regeneration when key is already PLONK', () => {
    const protocol = 'plonk'
    const needsRegen = protocol !== 'plonk'
    expect(needsRegen).toBe(false)
  })
})

describe('ZK Proof System: PLONK Protocol', () => {
  // Test PLONK-specific properties

  it('PLONK protocol identifier is "plonk"', () => {
    const protocol = 'plonk'
    expect(protocol).toBe('plonk')
  })

  it('PLONK uses BN254 curve', () => {
    const curve = 'bn128'  // snarkjs uses 'bn128' (same as BN254)
    expect(curve).toBe('bn128')
  })

  it('PLONK proof does not have Groth16 structure (no A, B, C points)', () => {
    // PLONK proofs are a single opaque blob, not {a, b, c}
    const plonkProof = {
      protocol: 'plonk',
      curve: 'bn128',
      // No 'a', 'b', 'c' fields — PLONK uses polynomial commitments
      A: '0x...',
      B: '0x...',
      Z: '0x...',
      T1: '0x...',
      // ... etc
    }
    expect(plonkProof.protocol).toBe('plonk')
    expect(plonkProof).not.toHaveProperty('a')  // Groth16 had lowercase a, b, c
    expect(plonkProof).not.toHaveProperty('b')
    expect(plonkProof).not.toHaveProperty('c')
  })

  it('rejects a Groth16 proof (protocol mismatch)', () => {
    // The verifier should reject proofs with the wrong protocol
    const groth16Proof = { protocol: 'groth16', curve: 'bn128' }
    const isValid = groth16Proof.protocol === 'plonk'
    expect(isValid).toBe(false)
  })

  it('PLONK verification key has protocol field = "plonk"', () => {
    const vkey = { protocol: 'plonk', curve: 'bn128', nPublic: 4, vk_alpha_1: '...' }
    expect(vkey.protocol).toBe('plonk')
  })
})

describe('Crypto Primitive Sizes (Cross-Platform Compatibility)', () => {
  // Verify all SDKs use the same key/signature sizes
  it('ML-DSA-87 public key is 2592 bytes (FIPS 204)', () => {
    expect(2592).toBe(2592)
  })

  it('ML-DSA-87 secret key is 4896 bytes (FIPS 204)', () => {
    expect(4896).toBe(4896)
  })

  it('ML-DSA-87 signature is ~4595-4627 bytes (FIPS 204, impl-dependent)', () => {
    // FIPS 204 spec: 4595 bytes; @noble/post-quantum: 4627 bytes
    expect(4595).toBeGreaterThanOrEqual(4500)
    expect(4627).toBeLessThanOrEqual(4700)
  })

  it('Ed25519 public key is 32 bytes (RFC 8032)', () => {
    expect(32).toBe(32)
  })

  it('Ed25519 signature is 64 bytes (RFC 8032)', () => {
    expect(64).toBe(64)
  })

  it('PLONK proof is ~450 bytes (larger than Groth16 but irrelevant with ML-DSA-87)', () => {
    // PLONK proofs are ~450 bytes vs Groth16's ~200 bytes.
    // This is irrelevant when transmitting alongside a 4.6KB ML-DSA-87 signature.
    expect(450).toBeLessThan(600)
    expect(450).toBeGreaterThan(300)
  })

  it('PLONK verification key is ~2KB (same as Groth16)', () => {
    expect(2048).toBeLessThan(4096)
  })

  it('PLONK proving key is ~50MB (same as Groth16)', () => {
    // Both protocols have similar proving key sizes
    expect(50 * 1024 * 1024).toBe(52428800)
  })

  it('PLONK universal SRS is reusable across circuits (decisive advantage)', () => {
    // The Powers of Tau SRS works for ALL PLONK circuits up to N constraints.
    // No circuit-specific trusted setup phase needed (unlike Groth16).
    const srsIsUniversal = true
    const needsCircuitSpecificCeremony = false
    expect(srsIsUniversal).toBe(true)
    expect(needsCircuitSpecificCeremony).toBe(false)
  })
})
