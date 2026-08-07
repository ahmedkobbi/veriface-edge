/**
 * VeriFace Edge — Cryptographic primitive tests
 *
 * Verifies that the SDK's crypto operations are correct, deterministic,
 * and round-trip compatible with the server-side crypto.
 */

import { test, expect, describe } from 'bun:test'
import {
  ed25519Generate,
  ed25519Sign,
  x25519Generate,
  x25519SharedSecret,
  hkdfSha256,
  aesGcmEncrypt,
  aesGcmDecrypt,
  blake3Hex,
  sha256Hex,
  createCommitment,
  verifyCommitment,
  signJwt,
  verifyJwt,
  hex,
  utf8,
  secureRandom,
} from '../src/sdk/crypto'
import { ed25519 } from '@noble/curves/ed25519.js'

describe('Ed25519 signing', () => {
  test('sign + verify round trip', () => {
    const { publicKey, privateKey } = ed25519Generate()
    const message = utf8.encode('hello veriface')
    const signature = ed25519Sign(message, privateKey)
    expect(signature.length).toBe(64)
    expect(ed25519.verify(signature, message, publicKey)).toBe(true)
  })

  test('different keys produce different signatures', () => {
    const alice = ed25519Generate()
    const bob = ed25519Generate()
    const msg = utf8.encode('test')
    const sigA = ed25519Sign(msg, alice.privateKey)
    const sigB = ed25519Sign(msg, bob.privateKey)
    expect(hex.encode(sigA)).not.toBe(hex.encode(sigB))
  })

  test('public key is 32 bytes', () => {
    const { publicKey } = ed25519Generate()
    expect(publicKey.length).toBe(32)
  })
})

describe('X25519 ECDH', () => {
  test('two parties derive the same shared secret', () => {
    const alice = x25519Generate()
    const bob = x25519Generate()

    const aliceShared = x25519SharedSecret(alice.privateKey, bob.publicKey)
    const bobShared = x25519SharedSecret(bob.privateKey, alice.publicKey)

    expect(hex.encode(aliceShared)).toBe(hex.encode(bobShared))
    expect(aliceShared.length).toBe(32)
  })
})

describe('HKDF-SHA256', () => {
  test('deterministic for same inputs', () => {
    const ikm = secureRandom(32)
    const salt = secureRandom(16)
    const info = utf8.encode('veriface-test')

    const k1 = hkdfSha256(ikm, salt, info, 32)
    const k2 = hkdfSha256(ikm, salt, info, 32)

    expect(hex.encode(k1)).toBe(hex.encode(k2))
    expect(k1.length).toBe(32)
  })

  test('different info produces different keys', () => {
    const ikm = secureRandom(32)
    const salt = secureRandom(16)

    const k1 = hkdfSha256(ikm, salt, utf8.encode('info-a'), 32)
    const k2 = hkdfSha256(ikm, salt, utf8.encode('info-b'), 32)

    expect(hex.encode(k1)).not.toBe(hex.encode(k2))
  })
})

describe('AES-256-GCM', () => {
  test('encrypt + decrypt round trip', () => {
    const key = secureRandom(32)
    const plaintext = utf8.encode('secret embedding data')
    const sealed = aesGcmEncrypt(key, plaintext)
    const decrypted = aesGcmDecrypt(key, sealed)
    expect(hex.encode(decrypted)).toBe(hex.encode(plaintext))
  })

  test('IV is 12 bytes, auth tag is 16 bytes', () => {
    const key = secureRandom(32)
    const sealed = aesGcmEncrypt(key, utf8.encode('x'))
    expect(sealed.iv.length).toBe(12)
    expect(sealed.authTag.length).toBe(16)
  })

  test('tampered ciphertext fails to decrypt', () => {
    const key = secureRandom(32)
    const sealed = aesGcmEncrypt(key, utf8.encode('secret'))
    // Flip a bit in the ciphertext
    const tampered = new Uint8Array(sealed.ciphertext)
    tampered[0] ^= 0x01
    expect(() => {
      aesGcmDecrypt(key, { ...sealed, ciphertext: tampered })
    }).toThrow()
  })

  test('wrong key fails to decrypt', () => {
    const key1 = secureRandom(32)
    const key2 = secureRandom(32)
    const sealed = aesGcmEncrypt(key1, utf8.encode('secret'))
    expect(() => {
      aesGcmDecrypt(key2, sealed)
    }).toThrow()
  })
})

describe('BLAKE3', () => {
  test('deterministic', () => {
    expect(blake3Hex('hello')).toBe(blake3Hex('hello'))
  })

  test('different inputs produce different hashes', () => {
    expect(blake3Hex('hello')).not.toBe(blake3Hex('world'))
  })

  test('output is 64 hex chars (256 bits)', () => {
    expect(blake3Hex('test').length).toBe(64)
  })
})

describe('SHA-256', () => {
  test('known vector', () => {
    // SHA-256('abc') = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('Pedersen commitment', () => {
  test('deterministic for same embedding + nonce', () => {
    const emb = new Float32Array([0.1, 0.2, 0.3, 0.4])
    const nonce = secureRandom(32)
    const c1 = createCommitment(emb, nonce)
    const c2 = createCommitment(emb, nonce)
    expect(c1).toBe(c2)
  })

  test('different nonce produces different commitment', () => {
    const emb = new Float32Array([0.1, 0.2, 0.3])
    const n1 = secureRandom(32)
    const n2 = secureRandom(32)
    expect(createCommitment(emb, n1)).not.toBe(createCommitment(emb, n2))
  })

  test('different embedding produces different commitment', () => {
    const e1 = new Float32Array([0.1, 0.2, 0.3])
    const e2 = new Float32Array([0.1, 0.2, 0.4])
    const nonce = secureRandom(32)
    expect(createCommitment(e1, nonce)).not.toBe(createCommitment(e2, nonce))
  })

  test('verifyCommitment returns true for matching pair', () => {
    const emb = new Float32Array([0.5, 0.5, 0.5])
    const nonce = secureRandom(32)
    const commitment = createCommitment(emb, nonce)
    expect(verifyCommitment(emb, nonce, commitment)).toBe(true)
  })

  test('verifyCommitment returns false for tampered embedding', () => {
    const emb = new Float32Array([0.5, 0.5, 0.5])
    const nonce = secureRandom(32)
    const commitment = createCommitment(emb, nonce)
    const tampered = new Float32Array([0.5, 0.5, 0.6])
    expect(verifyCommitment(tampered, nonce, commitment)).toBe(false)
  })
})

describe('JWT (EdDSA)', () => {
  test('sign + verify round trip', async () => {
    const { privateKey, publicKey } = ed25519Generate()
    const claims = {
      iss: 'veriface-edge',
      sub: 'session_123',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
      jti: 'test-jti',
    }
    const jwt = signJwt(claims, privateKey)
    const parts = jwt.split('.')
    expect(parts.length).toBe(3)

    const verified = await verifyJwt(jwt, publicKey)
    expect(verified).not.toBeNull()
    expect(verified?.sub).toBe('session_123')
  })

  test('expired JWT is rejected', async () => {
    const { privateKey, publicKey } = ed25519Generate()
    const claims = {
      iss: 'veriface-edge',
      sub: 'session_123',
      iat: Math.floor(Date.now() / 1000) - 120,
      exp: Math.floor(Date.now() / 1000) - 60,
      jti: 'test-jti',
    }
    const jwt = signJwt(claims, privateKey)
    const verified = await verifyJwt(jwt, publicKey)
    expect(verified).toBeNull()
  })
})

describe('Hex encoding', () => {
  test('round trip', () => {
    const bytes = secureRandom(32)
    const encoded = hex.encode(bytes)
    const decoded = hex.decode(encoded)
    expect(hex.encode(decoded)).toBe(encoded)
  })

  test('rejects odd-length strings', () => {
    expect(() => hex.decode('abc')).toThrow('odd-length')
  })
})
