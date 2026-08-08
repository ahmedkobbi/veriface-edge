/**
 * VeriFace Edge — Load Test (Node.js)
 *
 * Tests the session/init endpoint under concurrent load to verify
 * that the security hardening (Redis nonce cache, signed RelayState,
 * FIPS self-tests, CSRF, etc.) didn't introduce unacceptable latency.
 *
 * Metrics:
 *   - P50, P95, P99 latency
 *   - Error rate
 *   - Throughput (requests/sec)
 *
 * Usage:
 *   node scripts/load-test.js
 *   node scripts/load-test.js --vus=100 --duration=30
 */

const http = require('http')

const TARGET = process.env.LOAD_TEST_TARGET || 'http://localhost:3000'
const VUS = parseInt(process.argv.find(a => a.startsWith('--vus='))?.split('=')[1] || '50', 10)
const DURATION_SEC = parseInt(process.argv.find(a => a.startsWith('--duration='))?.split('=')[1] || '20', 10)

const TARGET_URL = new URL(TARGET)
const TEST_API_KEY = process.env.LOAD_TEST_API_KEY || 'vf_live_00000000000000000000000000000000'
const TEST_TENANT_ID = process.env.LOAD_TEST_TENANT_ID || 'load-test-tenant'

const latencies = []
let successCount = 0
let errorCount = 0
let rateLimitCount = 0

function makeRequest(path, body) {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(body)
    const req = http.request({
      hostname: TARGET_URL.hostname,
      port: TARGET_URL.port || 80,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data })
      })
    })
    req.on('error', () => resolve({ status: 0, body: '' }))
    req.write(bodyStr)
    req.end()
  })
}

async function worker(workerId) {
  const endTime = Date.now() + DURATION_SEC * 1000
  while (Date.now() < endTime) {
    const userId = `loadtest_w${workerId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const start = performance.now()

    const res = await makeRequest('/api/session/init', {
      tenantId: TEST_TENANT_ID,
      flow: 'authenticate',
      externalUserId: userId,
    })

    const elapsed = performance.now() - start
    latencies.push(elapsed)

    if (res.status === 200) {
      successCount++
    } else if (res.status === 429) {
      rateLimitCount++
    } else {
      errorCount++
    }
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)].toFixed(1)
}

async function main() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`)
  console.log(`║  VeriFace Edge — Load Test                              ║`)
  console.log(`╠════════════════════════════════════════════════════════╣`)
  console.log(`║  Target:   ${TARGET.padEnd(44)}║`)
  console.log(`║  VUs:      ${String(VUS).padEnd(44)}║`)
  console.log(`║  Duration: ${String(DURATION_SEC + 's').padEnd(44)}║`)
  console.log(`╚════════════════════════════════════════════════════════╝\n`)

  // Health check
  const healthRes = await new Promise((resolve) => {
    http.get(`${TARGET}/api/health`, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    }).on('error', () => resolve({ status: 0, body: '' }))
  })

  if (healthRes.status === 0) {
    console.error('❌ Server not reachable. Start the dev server first: bun run dev')
    process.exit(1)
  }
  console.log(`✅ Health check: HTTP ${healthRes.status}\n`)

  console.log(`Running ${VUS} concurrent workers for ${DURATION_SEC}s...\n`)

  const start = Date.now()
  const workers = Array.from({ length: VUS }, (_, i) => worker(i + 1))
  await Promise.all(workers)
  const elapsed = (Date.now() - start) / 1000

  const total = successCount + errorCount + rateLimitCount
  const rps = (total / elapsed).toFixed(1)

  console.log(`\n╔════════════════════════════════════════════════════════╗`)
  console.log(`║  Load Test Results                                      ║`)
  console.log(`╠════════════════════════════════════════════════════════╣`)
  console.log(`║  Duration:       ${elapsed.toFixed(1).padEnd(42)}s║`)
  console.log(`║  Total requests: ${String(total).padEnd(42)}║`)
  console.log(`║  Throughput:     ${rps.padEnd(42)}║`)
  console.log(`║                                                          ║`)
  console.log(`║  Latency (ms):                                          ║`)
  console.log(`║    P50:  ${percentile(latencies, 50).padEnd(45)}║`)
  console.log(`║    P95:  ${percentile(latencies, 95).padEnd(45)}║`)
  console.log(`║    P99:  ${percentile(latencies, 99).padEnd(45)}║`)
  console.log(`║                                                          ║`)
  console.log(`║  Status codes:                                          ║`)
  console.log(`║    200 (success): ${String(successCount).padEnd(37)}║`)
  console.log(`║    429 (rate limited): ${String(rateLimitCount).padEnd(34)}║`)
  console.log(`║    Other (error): ${String(errorCount).padEnd(38)}║`)
  console.log(`╚════════════════════════════════════════════════════════╝\n`)

  // SLA check
  const p95 = parseFloat(percentile(latencies, 95))
  const errorRate = total > 0 ? (errorCount / total) * 100 : 0

  console.log('SLA Thresholds:')
  console.log(`  P95 < 500ms:     ${p95 < 500 ? '✅ PASS' : '❌ FAIL'} (${p95}ms)`)
  console.log(`  Error rate < 5%: ${errorRate < 5 ? '✅ PASS' : '❌ FAIL'} (${errorRate.toFixed(1)}%)`)

  process.exit(p95 < 500 && errorRate < 5 ? 0 : 1)
}

main()
