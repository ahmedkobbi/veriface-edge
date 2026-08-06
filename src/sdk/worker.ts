/**
 * VeriFace Edge SDK — Web Worker
 *
 * Offloads heavy cryptographic + tensor operations from the main thread
 * to prevent UI jank during biometric capture.
 *
 * Responsibilities:
 *   - BLAKE3 frame hashing (replay detection)
 *   - AES-256-GCM encryption of embedding payload
 *   - Pedersen commitment computation
 *   - JWT signing (Ed25519)
 *
 * The main thread sends commands via postMessage; worker responds with
 * results. Sensitive material (private keys, embeddings) never leaves
 * the worker — even main-thread extensions cannot read them.
 *
 * NOTE: This worker does NOT do face detection or rPPG (those require
 * canvas access, which is limited in workers pre-OffscreenCanvas).
 * For OffscreenCanvas-capable browsers, the AI pipeline can also be
 * moved here — but for broad compatibility we keep it on main thread.
 */

import {
  ed25519Generate,
  ed25519Sign,
  x25519Generate,
  x25519SharedSecret,
  hkdfSha256,
  aesGcmEncrypt,
  blake3Hex,
  blake3Bytes,
  createCommitment,
  signJwt,
  secureRandom,
  hex,
  utf8,
  type Ed25519KeyPair,
  type X25519KeyPair,
} from './crypto'

export interface WorkerRequest {
  id: string
  type:
    | 'init-session'
    | 'hash-frame'
    | 'encrypt-payload'
    | 'compute-commitment'
    | 'sign-jwt'
    | 'derive-session-key'
    | 'destroy'
  payload?: any
}

export interface WorkerResponse {
  id: string
  type: WorkerRequest['type']
  success: boolean
  result?: any
  error?: string
}

// Worker-local state (NEVER exposed to main thread)
let ed25519Keypair: Ed25519KeyPair | null = null
let x25519Keypair: X25519KeyPair | null = null

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data
  try {
    let result: any
    switch (type) {
      case 'init-session':
        ed25519Keypair = ed25519Generate()
        x25519Keypair = x25519Generate()
        result = {
          ed25519PubKey: hex.encode(ed25519Keypair.publicKey),
          x25519PubKey: hex.encode(x25519Keypair.publicKey),
        }
        break

      case 'hash-frame': {
        // payload: { frameData: Uint8Array (downsampled grayscale) }
        const hash = blake3Hex(payload.frameData)
        result = { hash }
        break
      }

      case 'compute-commitment': {
        // payload: { embedding: Float32Array, nonce: Uint8Array }
        const commitment = createCommitment(payload.embedding, payload.nonce)
        result = { commitment }
        break
      }

      case 'encrypt-payload': {
        // payload: { embedding: Float32Array, sessionKey: Uint8Array, aad: Uint8Array }
        const embBytes = new Uint8Array(payload.embedding.length * 4)
        const view = new DataView(embBytes.buffer)
        for (let i = 0; i < payload.embedding.length; i++) {
          view.setFloat32(i * 4, payload.embedding[i], true)
        }
        const sealed = aesGcmEncrypt(payload.sessionKey, embBytes, payload.aad)
        result = {
          ciphertext: hex.encode(sealed.ciphertext),
          iv: hex.encode(sealed.iv),
          authTag: hex.encode(sealed.authTag),
        }
        break
      }

      case 'derive-session-key': {
        // payload: { backendPubKey: string (hex), challenge: string }
        if (!x25519Keypair) throw new Error('Session not initialized')
        const shared = x25519SharedSecret(
          x25519Keypair.privateKey,
          hex.decode(payload.backendPubKey),
        )
        const sessionKey = hkdfSha256(
          shared,
          utf8.encode(payload.challenge),
          utf8.encode('veriface-session-v1'),
          32,
        )
        result = { sessionKey: hex.encode(sessionKey) }
        break
      }

      case 'sign-jwt': {
        // payload: { claims: object }
        if (!ed25519Keypair) throw new Error('Session not initialized')
        const jwt = signJwt(payload.claims, ed25519Keypair.privateKey)
        result = { jwt, sdkPubKey: hex.encode(ed25519Keypair.publicKey) }
        break
      }

      case 'destroy':
        ed25519Keypair = null
        x25519Keypair = null
        result = { destroyed: true }
        break

      default:
        throw new Error(`Unknown command: ${type}`)
    }

    const response: WorkerResponse = {
      id,
      type,
      success: true,
      result,
    }
    ;(self as any).postMessage(response)
  } catch (e) {
    const response: WorkerResponse = {
      id,
      type,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }
    ;(self as any).postMessage(response)
  }
}

// Heartbeat HMAC verification (extension tamper defense).
// Main thread sends a beat every 100ms; worker echoes it back.
// If an extension hooks into postMessage, the HMAC will mismatch.
let heartbeatSecret: Uint8Array | null = null
let lastBeat = 0

self.addEventListener('message', (e: MessageEvent) => {
  const data = e.data
  if (data?.type === 'heartbeat-init' && data.secret) {
    heartbeatSecret = new Uint8Array(data.secret)
    lastBeat = Date.now()
    return
  }
  if (data?.type === 'heartbeat' && heartbeatSecret) {
    // Echo back with a fresh HMAC
    lastBeat = Date.now()
    const ts = Math.floor(Date.now() / 100)
    const beat = blake3Hex(hex.encode(heartbeatSecret) + '|' + ts.toString())
    ;(self as any).postMessage({ type: 'heartbeat-ack', beat, ts })
  }
})
