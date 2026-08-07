/**
 * VeriFace Edge SDK — Neural Embedding via ONNX Runtime Web
 *
 * Uses ONNX Runtime Web with the WebGPU Execution Provider to run
 * a real neural network face embedding model in the browser.
 *
 * Model: MobileFaceNet (1.2MB, INT8 quantized) — a lightweight
 * ArcFace-variant designed for mobile/edge deployment. Achieves
 * 99.5%+ on LFW, suitable for 1:1 verification.
 *
 * Fallback: if ONNX model fails to load (offline, CORS, etc.),
 * falls back to the geometric embedding from ai-pipeline.ts.
 *
 * In production, this would load a quantized ArcFace-R100 model
 * (24MB INT8) for IJB-C-grade accuracy.
 */

import * as ort from 'onnxruntime-web'
import { generateEmbedding as generateGeometricEmbedding, type DetectedFace } from './ai-pipeline'

let embeddingSession: ort.InferenceSession | null = null
let sessionInitPromise: Promise<ort.InferenceSession | null> | null = null

// MobileFaceNet model — hosted on HuggingFace CDN
// In production, this would be served from your own CDN with SRI.
const MODEL_URL =
  'https://huggingface.co/onnx-community/mobilefacenet/resolve/main/model_int8.onnx'

/**
 * Initialize the ONNX embedding session.
 * Uses WebGPU if available, falls back to WASM SIMD.
 */
async function getEmbeddingSession(): Promise<ort.InferenceSession | null> {
  if (embeddingSession) return embeddingSession
  if (sessionInitPromise) return sessionInitPromise

  sessionInitPromise = (async () => {
    try {
      // Configure ONNX Runtime
      ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4)
      ort.env.wasm.simd = true
      ort.env.wasm.proxy = true  // run in worker

      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: [
          { name: 'webgpu' as any },
          { name: 'wasm-simd' as any },
        ],
        graphOptimizationLevel: 'all',
        enableMemPattern: true,
        executionMode: 'sequential',
      })

      embeddingSession = session
      return session
    } catch (e) {
      console.warn('[VeriFace] ONNX model load failed, falling back to geometric embedding:', e)
      return null
    }
  })()

  return sessionInitPromise
}

/**
 * Generate a 512-dim neural embedding from an aligned face image.
 *
 * Input: 112x112 RGB face (BGR or RGB depending on model — MobileFaceNet uses RGB)
 * Output: 512-dim L2-normalized embedding
 *
 * Falls back to geometric embedding if ONNX model is unavailable.
 */
export async function generateNeuralEmbedding(
  alignedFace: HTMLCanvasElement,
  landmarks: Array<{ x: number; y: number; z: number }>,
): Promise<Float32Array> {
  const session = await getEmbeddingSession()

  if (!session) {
    // Fallback: geometric embedding
    return generateGeometricEmbedding(landmarks)
  }

  try {
    // Extract pixel data from canvas
    const ctx = alignedFace.getContext('2d', { willReadFrequently: true })!
    const imageData = ctx.getImageData(0, 0, 112, 112)

    // Convert to NCHW float tensor [1, 3, 112, 112]
    // MobileFaceNet expects: RGB, normalized to [0, 1] or [-1, 1]
    const input = new Float32Array(3 * 112 * 112)
    for (let y = 0; y < 112; y++) {
      for (let x = 0; x < 112; x++) {
        const idx = (y * 112 + x) * 4
        const r = imageData.data[idx] / 255.0
        const g = imageData.data[idx + 1] / 255.0
        const b = imageData.data[idx + 2] / 255.0
        // Normalize: (x - 0.5) / 0.5 = 2x - 1
        input[0 * 112 * 112 + y * 112 + x] = r * 2 - 1
        input[1 * 112 * 112 + y * 112 + x] = g * 2 - 1
        input[2 * 112 * 112 + y * 112 + x] = b * 2 - 1
      }
    }

    // Run inference
    const tensor = new ort.Tensor('float32', input, [1, 3, 112, 112])
    const inputName = session.inputNames[0]
    const output = await session.run({ [inputName]: tensor })

    // Get output embedding (typically 128 or 512 dim depending on model)
    const outputName = session.outputNames[0]
    const outputTensor = output[outputName]
    const embedding = outputTensor.data as Float32Array

    // L2 normalize
    let norm = 0
    for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i]
    norm = Math.sqrt(norm) || 1
    const normalized = new Float32Array(512)
    for (let i = 0; i < Math.min(embedding.length, 512); i++) {
      normalized[i] = embedding[i] / norm
    }

    return normalized
  } catch (e) {
    console.warn('[VeriFace] Neural embedding failed, falling back to geometric:', e)
    return generateGeometricEmbedding(landmarks)
  }
}

/**
 * Check if the neural model is loaded and ready.
 */
export function isNeuralModelReady(): boolean {
  return embeddingSession !== null
}

/**
 * Preload the neural model (call during SDK init for faster first auth).
 */
export async function preloadNeuralModel(): Promise<void> {
  await getEmbeddingSession()
}
