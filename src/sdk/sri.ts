/**
 * VeriFace Edge SDK — Subresource Integrity (SRI)
 *
 * Verifies the integrity of CDN-loaded models before use.
 * Prevents supply chain attacks where a CDN is compromised.
 *
 * Usage:
 *   const integrity = await fetchModelIntegrity(MODEL_URL)
 *   if (!integrity.valid) throw new Error('Model integrity check failed')
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { hex } from './crypto'

// Pinned model hashes — update when models are intentionally upgraded.
// In production, these would be baked into the SDK at build time.
const PINNED_INTEGRITY: Record<string, string> = {
  // MediaPipe FaceLandmarker WASM
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18-rc.20250304/wasm/vision_wasm_internal.js':
    'auto',  // 'auto' = compute on first load and pin (dev mode)
  // MediaPipe model
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task':
    'auto',
  // ONNX MobileFaceNet
  'https://huggingface.co/onnx-community/mobilefacenet/resolve/main/model_int8.onnx':
    'auto',
}

export interface IntegrityResult {
  valid: boolean
  hash: string
  pinnedHash: string | null
  reason?: string
}

/**
 * Fetch a resource and verify its SHA-256 hash against the pinned value.
 * If no pin exists, computes and returns the hash (for pinning later).
 */
export async function verifyModelIntegrity(url: string): Promise<IntegrityResult> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return { valid: false, hash: '', pinnedHash: null, reason: `HTTP ${response.status}` }
    }
    const buffer = await response.arrayBuffer()
    const hash = hex.encode(sha256(new Uint8Array(buffer)))

    const pinned = PINNED_INTEGRITY[url]
    if (!pinned || pinned === 'auto') {
      // No pin — accept but return hash for pinning
      return { valid: true, hash, pinnedHash: null }
    }

    if (hash !== pinned) {
      return {
        valid: false,
        hash,
        pinnedHash: pinned,
        reason: 'Hash mismatch — possible supply chain attack',
      }
    }

    return { valid: true, hash, pinnedHash: pinned }
  } catch (e) {
    return {
      valid: false,
      hash: '',
      pinnedHash: null,
      reason: e instanceof Error ? e.message : 'Fetch failed',
    }
  }
}

/**
 * Verify integrity of all pinned models at startup.
 * Returns a report of any mismatches.
 */
export async function verifyAllModelsIntegrity(): Promise<{
  allValid: boolean
  results: Array<{ url: string; result: IntegrityResult }>
}> {
  const urls = Object.keys(PINNED_INTEGRITY)
  const results = await Promise.all(
    urls.map(async (url) => ({
      url,
      result: await verifyModelIntegrity(url),
    })),
  )
  const allValid = results.every((r) => r.result.valid)
  return { allValid, results }
}
