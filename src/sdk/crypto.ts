/**
 * VeriFace Edge SDK — Client-side Cryptographic Primitives
 *
 * Mirrors the server-side crypto (lib/crypto-server.ts) but bundled for
 * the browser. Uses @noble/curves / @noble/hashes (audited, constant-time).
 *
 * Key responsibilities:
 *   - Generate ephemeral Ed25519 + X25519 keypairs per session
 *   - Sign the JWT payload that wraps the ZK proof + liveness report
 *   - Encrypt the embedding payload via ECDH-derived AES-256-GCM key
 *   - Compute Pedersen commitment (BLAKE3-based)
 *   - Compute per-frame BLAKE3 hashes for replay detection
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { blake3 } from '@noble/hashes/blake3.js'
import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { hmac } from '@noble/hashes/hmac.js'

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

export const base64 = {
  encode(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  },
  decode(s: string): Uint8Array {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  },
}

export interface Ed25519KeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export function ed25519Generate(): Ed25519KeyPair {
  const { secretKey, publicKey } = ed25519.keygen()
  return { publicKey, privateKey: secretKey }
}

export function ed25519Sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey)
}

export interface X25519KeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
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

export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
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

export interface AesGcmCiphertext {
  ciphertext: Uint8Array
  iv: Uint8Array
  authTag: Uint8Array
}

export function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): AesGcmCiphertext {
  const iv = randomBytes(12)
  const cipher = gcm(key, iv, aad)
  const sealed = cipher.encrypt(plaintext)
  const ciphertext = sealed.subarray(0, sealed.length - 16)
  const authTag = sealed.subarray(sealed.length - 16)
  return { ciphertext, iv, authTag }
}

export function blake3Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input
  return hex.encode(blake3(bytes))
}

export function blake3Bytes(input: string | Uint8Array): Uint8Array {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input
  return blake3(bytes)
}

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8.encode(input) : input
  return hex.encode(sha256(bytes))
}

const COMMIT_DOMAIN = utf8.encode('veriface-commit-v1')

export function createCommitment(
  embedding: Float32Array,
  nonce: Uint8Array,
): string {
  const embBytes = new Uint8Array(embedding.length * 4)
  const view = new DataView(embBytes.buffer)
  for (let i = 0; i < embedding.length; i++) {
    view.setFloat32(i * 4, embedding[i], true)
  }
  const input = new Uint8Array(COMMIT_DOMAIN.length + embBytes.length + nonce.length)
  input.set(COMMIT_DOMAIN)
  input.set(embBytes, COMMIT_DOMAIN.length)
  input.set(nonce, COMMIT_DOMAIN.length + embBytes.length)
  return hex.encode(blake3(input))
}

export function secureRandom(length: number): Uint8Array {
  return randomBytes(length)
}

export function secureRandomHex(length: number): string {
  return hex.encode(randomBytes(length))
}

function base64urlEncode(bytes: Uint8Array): string {
  return base64.encode(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlDecode(s: string): Uint8Array {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/')
  while (padded.length % 4 !== 0) padded += '='
  return base64.decode(padded)
}

export interface JwtHeader {
  alg: 'EdDSA'
  typ: 'JWT'
}

export interface JwtClaims {
  iss: string
  sub: string
  iat: number
  exp: number
  jti: string
  [key: string]: unknown
}

export function signJwt(claims: JwtClaims, privateKey: Uint8Array): string {
  const header: JwtHeader = { alg: 'EdDSA', typ: 'JWT' }
  const headerB64 = base64urlEncode(utf8.encode(JSON.stringify(header)))
  const payloadB64 = base64urlEncode(utf8.encode(JSON.stringify(claims)))
  const signingInput = headerB64 + '.' + payloadB64
  const signature = ed25519Sign(utf8.encode(signingInput), privateKey)
  const sigB64 = base64urlEncode(signature)
  return signingInput + '.' + sigB64
}

export async function verifyJwt(
  token: string,
  publicKey: Uint8Array,
): Promise<JwtClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts
  const signingInput = headerB64 + '.' + payloadB64
  const signature = base64urlDecode(sigB64)
  try {
    if (!ed25519.verify(signature, utf8.encode(signingInput), publicKey)) {
      return null
    }
  } catch {
    return null
  }
  try {
    const claims = JSON.parse(utf8.decode(base64urlDecode(payloadB64))) as JwtClaims
    const now = Math.floor(Date.now() / 1000)
    if (claims.exp && claims.exp < now) return null
    return claims
  } catch {
    return null
  }
}
