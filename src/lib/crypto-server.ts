/**
 * VeriFace Edge — Server-side Cryptographic Primitives
 *
 * Implements:
 *   - Ed25519 signature verification (SDK-signed JWTs)
 *   - X25519 ECDH key exchange (per-session forward secrecy)
 *   - AES-256-GCM decryption of SDK payloads
 *   - BLAKE3 / SHA-256 hashing for audit log chain
 *   - Pedersen-style commitment verification (simplified — uses SHA-256
 *     with domain separation in lieu of full elliptic-curve Pedersen)
 *   - HMAC-SHA256 for webhook signing
 *
 * All primitives use @noble/curves and @noble/hashes — audited,
 * constant-time, side-channel-resistant implementations.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { blake3 } from '@noble/hashes/blake3.js'
import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { hmac } from '@noble/hashes/hmac.js'

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

export const hex = {
  encode(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, '0')
    }
    return out
  },
  decode(s: string): Uint8Array {
    if (s.length % 2 !== 0) throw new Error('hex: odd-length string')
    const out = new Uint8Array(s.length / 2)
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
    }
    return out
  },
}

export const utf8 = {
  encode(s: string): Uint8Array {
    return new TextEncoder().encode(s)
  },
  decode(b: Uint8Array): string {
    return new TextDecoder().decode(b)
  },
}

// ---------------------------------------------------------------------------
// Ed25519 — signing & verification
// ---------------------------------------------------------------------------

export interface Ed25519KeyPair {
  publicKey: Uint8Array  // 32 bytes
  privateKey: Uint8Array // 32 bytes (seed) — alias for secretKey in noble v2
}

export function ed25519Generate(): Ed25519KeyPair {
  const { secretKey, publicKey } = ed25519.keygen()
  return { publicKey, privateKey: secretKey }
}

export function ed25519Sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey)
}

export function ed25519Verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// X25519 — ECDH key agreement (per-session forward secrecy)
// ---------------------------------------------------------------------------

export interface X25519KeyPair {
  publicKey: Uint8Array  // 32 bytes
  privateKey: Uint8Array // 32 bytes
}

export function x25519Generate(): X25519KeyPair {
  const { secretKey, publicKey } = x25519.keygen()
  return { publicKey, privateKey: secretKey }
}

export function x25519SharedSecret(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(myPrivateKey, theirPublicKey)
}

// ---------------------------------------------------------------------------
// Key derivation — HKDF-SHA256
// ---------------------------------------------------------------------------

export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  // RFC 5869 HKDF-Extract + HKDF-Expand
  const prk = hmac(sha256, salt, ikm)
  const out = new Uint8Array(length)
  let t = new Uint8Array(0)
  let pos = 0
  let counter = 1
  while (pos < length) {
    const input = new Uint8Array(t.length + info.length + 1)
    input.set(t)
    input.set(info, t.length)
    input[info.length + t.length] = counter
    t = hmac(sha256, prk, input)
    const toCopy = Math.min(t.length, length - pos)
    out.set(t.subarray(0, toCopy), pos)
    pos += toCopy
    counter++
  }
  return out
}

// ---------------------------------------------------------------------------
// AES-256-GCM — authenticated encryption for templates & payloads
// ---------------------------------------------------------------------------

export interface AesGcmCiphertext {
  ciphertext: Uint8Array
  iv: Uint8Array       // 12 bytes
  authTag: Uint8Array  // 16 bytes
}

export function aesGcmEncrypt(
  key: Uint8Array,        // 32 bytes (AES-256)
  plaintext: Uint8Array,
  aad?: Uint8Array,
): AesGcmCiphertext {
  const iv = randomBytes(12)
  const cipher = gcm(key, iv, aad)
  const sealed = cipher.encrypt(plaintext)
  // @noble/ciphers returns ciphertext || tag (16-byte tag appended)
  const ciphertext = sealed.subarray(0, sealed.length - 16)
  const authTag = sealed.subarray(sealed.length - 16)
  return { ciphertext, iv, authTag }
}

export function aesGcmDecrypt(
  key: Uint8Array,
  data: AesGcmCiphertext,
  aad?: Uint8Array,
): Uint8Array {
  const sealed = new Uint8Array(data.ciphertext.length + data.authTag.length)
  sealed.set(data.ciphertext)
  sealed.set(data.authTag, data.ciphertext.length)
  const cipher = gcm(key, data.iv, aad)
  return cipher.decrypt(sealed)
}

// ---------------------------------------------------------------------------
// Hashing — SHA-256, BLAKE3
// ---------------------------------------------------------------------------

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input
  return hex.encode(sha256(bytes))
}

export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input
  return sha256(bytes)
}

export function blake3Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input
  return hex.encode(blake3(bytes))
}

export function blake3Bytes(input: string | Uint8Array): Uint8Array {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input
  return blake3(bytes)
}

// ---------------------------------------------------------------------------
// Pedersen-style commitment (simplified)
//
// In a full ZK system, this would be C = g^x * h^r on an elliptic curve.
// For our backend verification we use a hash-based commitment that achieves
// the same properties: binding (cannot change x without changing C) and
// hiding (C reveals nothing about x without revealing r).
//
//   C = BLAKE3("veriface-commit-v1" || x || r)
//
// The ZK proof on the client side demonstrates knowledge of (x, r) such
// that C matches, without revealing either.
// ---------------------------------------------------------------------------

const COMMIT_DOMAIN = utf8.encode('veriface-commit-v1')

export function createCommitment(
  embedding: Float32Array,
  nonce: Uint8Array,
): string {
  // Encode embedding as little-endian bytes
  const embBytes = new Uint8Array(embedding.length * 4)
  const view = new DataView(embBytes.buffer)
  for (let i = 0; i < embedding.length; i++) {
    view.setFloat32(i * 4, embedding[i], true)
  }
  // Concatenate domain || embBytes || nonce
  const input = new Uint8Array(COMMIT_DOMAIN.length + embBytes.length + nonce.length)
  input.set(COMMIT_DOMAIN)
  input.set(embBytes, COMMIT_DOMAIN.length)
  input.set(nonce, COMMIT_DOMAIN.length + embBytes.length)
  return hex.encode(blake3(input))
}

export function verifyCommitment(
  embedding: Float32Array,
  nonce: Uint8Array,
  expectedCommitment: string,
): boolean {
  const actual = createCommitment(embedding, nonce)
  // Constant-time comparison
  if (actual.length !== expectedCommitment.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedCommitment.charCodeAt(i)
  }
  return diff === 0
}

// ---------------------------------------------------------------------------
// Constant-time string comparison
// ---------------------------------------------------------------------------

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 — webhook signing
// ---------------------------------------------------------------------------

export function hmacSha256(key: Uint8Array, message: Uint8Array): string {
  return hex.encode(hmac(sha256, key, message))
}

// ---------------------------------------------------------------------------
// Random bytes
// ---------------------------------------------------------------------------

export function secureRandom(length: number): Uint8Array {
  return randomBytes(length)
}

export function secureRandomHex(length: number): string {
  return hex.encode(randomBytes(length))
}
