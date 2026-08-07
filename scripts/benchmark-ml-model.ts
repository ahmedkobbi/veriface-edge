/**
 * VeriFace Edge — ML Model Benchmarking Script
 *
 * Benchmarks the face embedding model on:
 *   - Inference time (ms per face)
 *   - Embedding quality (L2 norm before normalization)
 *   - Model size on disk
 *   - Memory usage during inference
 *
 * Runs on ONNX Runtime (cross-platform — same model as iOS/Android).
 * Use this to verify model quality before deploying to production.
 *
 * Usage:
 *   bun run scripts/benchmark-ml-model.ts
 *   bun run scripts/benchmark-ml-model.ts --model models/onnx/mobilefacenet.onnx
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MODEL_PATHS = [
  'models/onnx/mobilefacenet.onnx',
  'models/onnx/arcface-resnet50.onnx',
]

const INPUT_SIZE = 112
const EMBEDDING_DIM = 512

async function benchmarkModel(modelPath: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Benchmarking: ${modelPath}`)
  console.log(`${'─'.repeat(60)}`)

  if (!existsSync(modelPath)) {
    console.log(`❌ Model not found: ${modelPath}`)
    console.log(`   Run: python3 scripts/download-ml-models.py`)
    return
  }

  // File size
  const sizeBytes = statSync(modelPath).size
  const sizeMB = sizeBytes / 1024 / 1024
  console.log(`📁 Model size: ${sizeMB.toFixed(2)} MB`)

  // Load ONNX Runtime
  let ort: any
  try {
    ort = await import('onnxruntime-node')
  } catch {
    try {
      ort = await import('onnxruntime-web')
    } catch {
      console.log('❌ onnxruntime not installed. Install with: bun add onnxruntime-node')
      return
    }
  }

  // Create session
  const startTime = Date.now()
  let session: any
  try {
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    })
  } catch (e) {
    console.log(`❌ Failed to load model: ${e}`)
    return
  }
  const loadTime = Date.now() - startTime
  console.log(`⏱️  Model load time: ${loadTime}ms`)

  // Get input/output info
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  console.log(`📋 Input:  ${inputName}`)
  console.log(`📋 Output: ${outputName}`)

  // Generate test input (random face-like embedding)
  const input = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE)
  for (let i = 0; i < input.length; i++) {
    // Normalize to [-1, 1] (standard for face recognition models)
    input[i] = Math.random() * 2 - 1
  }

  // Warmup (5 runs to stabilize)
  console.log(`\n🔥 Warming up (5 runs)...`)
  for (let i = 0; i < 5; i++) {
    const feeds = { [inputName]: input }
    await session.run(feeds)
  }

  // Benchmark (50 runs)
  const NUM_RUNS = 50
  console.log(`📊 Benchmarking (${NUM_RUNS} runs)...`)

  const times: number[] = []
  let lastOutput: any

  for (let i = 0; i < NUM_RUNS; i++) {
    const feeds = { [inputName]: input }
    const t0 = process.hrtime.bigint()
    const results = await session.run(feeds)
    const t1 = process.hrtime.bigint()
    const ms = Number(t1 - t0) / 1_000_000
    times.push(ms)
    lastOutput = results[outputName]
  }

  // Statistics
  times.sort((a, b) => a - b)
  const avg = times.reduce((s, t) => s + t, 0) / times.length
  const p50 = times[Math.floor(times.length * 0.5)]
  const p95 = times[Math.floor(times.length * 0.95)]
  const p99 = times[Math.floor(times.length * 0.99)]
  const min = times[0]
  const max = times[times.length - 1]

  console.log(`\n📊 Inference Time (ms):`)
  console.log(`   Min:  ${min.toFixed(2)}ms`)
  console.log(`   Avg:  ${avg.toFixed(2)}ms`)
  console.log(`   P50:  ${p50.toFixed(2)}ms`)
  console.log(`   P95:  ${p95.toFixed(2)}ms`)
  console.log(`   P99:  ${p99.toFixed(2)}ms`)
  console.log(`   Max:  ${max.toFixed(2)}ms`)

  // Embedding quality
  if (lastOutput && lastOutput.data) {
    const embedding = Array.from(lastOutput.data as Float32Array)
    let sumSq = 0
    for (const v of embedding) sumSq += v * v
    const l2Norm = Math.sqrt(sumSq)
    console.log(`\n📏 Embedding Quality:`)
    console.log(`   Dimension: ${embedding.length}`)
    console.log(`   L2 norm (pre-normalization): ${l2Norm.toFixed(4)}`)
    console.log(`   Quality score: ${Math.min(1, l2Norm / 10).toFixed(4)}`)

    // Check for NaN/Inf
    const hasNaN = embedding.some((v) => isNaN(v))
    const hasInf = embedding.some((v) => !isFinite(v))
    if (hasNaN || hasInf) {
      console.log(`   ⚠️  WARNING: Embedding contains NaN/Inf values!`)
    } else {
      console.log(`   ✅ No NaN/Inf values`)
    }
  }

  // Memory usage
  const memUsage = process.memoryUsage()
  console.log(`\n💾 Memory Usage:`)
  console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`)
  console.log(`   Heap: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`)

  // Throughput
  const throughput = 1000 / avg
  console.log(`\n🚀 Throughput: ${throughput.toFixed(1)} inferences/sec`)

  // Verdict
  console.log(`\n✅ Verdict:`)
  if (avg < 50) {
    console.log(`   ✅ Fast enough for real-time use (< 50ms)`)
  } else if (avg < 200) {
    console.log(`   ⚠️  Acceptable for authentication (50-200ms)`)
  } else {
    console.log(`   ❌ Too slow for production (> 200ms) — use a smaller model`)
  }

  if (sizeMB < 10) {
    console.log(`   ✅ Model size acceptable for mobile (< 10MB)`)
  } else if (sizeMB < 50) {
    console.log(`   ⚠️  Model size large for mobile (10-50MB)`)
  } else {
    console.log(`   ❌ Model too large for mobile (> 50MB)`)
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║       VeriFace Edge — ML Model Benchmarking              ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  // Check command-line args for custom model path
  const customPath = process.argv.find((a) => a.endsWith('.onnx'))
  const paths = customPath ? [customPath] : MODEL_PATHS.filter(existsSync)

  if (paths.length === 0) {
    console.log('\n❌ No models found. Run: python3 scripts/download-ml-models.py')
    console.log(`   Expected at: ${MODEL_PATHS.join(', ')}`)
    return
  }

  for (const path of paths) {
    await benchmarkModel(join(process.cwd(), path))
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log('Benchmarking complete.')
  console.log(`${'═'.repeat(60)}`)
}

main().catch(console.error)
