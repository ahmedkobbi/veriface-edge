/**
 * VeriFace Edge — k6 Stress Test: 10K Concurrent Auths
 *
 * Target: 10,000 concurrent virtual users hitting /api/session/init
 * Simulates: Growth plan × 100 tenants (100K calls/month each)
 *
 * This is a BREAKPOINT test — it intentionally exceeds the rate limit
 * to find where the system breaks. Use the regular load test for
 * SLA validation; use this for capacity planning.
 *
 * Usage:
 *   k6 run tests/load/k6-stress-10k.js
 *   k6 run tests/load/k6-stress-10k.js --env TARGET_URL=https://api.veriface.io
 *
 * Stages:
 *   1. Ramp to 1K VUs (normal load)
 *   2. Ramp to 5K VUs (peak load)
 *   3. Ramp to 10K VUs (stress — expect rate limits + errors)
 *   4. Hold at 10K for 2 min (sustained stress)
 *   5. Ramp down to 0
 *
 * Expected results:
 *   - At 1K VUs: P95 < 200ms, 0% errors
 *   - At 5K VUs: P95 < 500ms, < 5% rate limit hits
 *   - At 10K VUs: P95 < 2000ms, rate limit hits expected
 *   - System should NOT crash — graceful degradation via rate limiting
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter, Gauge } from 'k6/metrics'

const TARGET_URL = __ENV.TARGET_URL || 'http://localhost:3000'
const TEST_API_KEY = __ENV.TEST_API_KEY || 'vf_live_00000000000000000000000000000000'
const TEST_TENANT_ID = __ENV.TEST_TENANT_ID || 'test-tenant-stress'

// Custom metrics
const authSuccess = new Rate('stress_auth_success')
const authRejected = new Rate('stress_auth_rejected')
const authError = new Rate('stress_auth_error')
const initLatency = new Trend('stress_init_latency', true)
const rateLimit429 = new Counter('stress_429_count')
const activeVUs = new Gauge('stress_active_vus')

export const options = {
  scenarios: {
    stress_10k: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 1000 },    // Stage 1: Normal load
        { duration: '2m', target: 1000 },    // Hold normal
        { duration: '1m', target: 5000 },    // Stage 2: Peak load
        { duration: '2m', target: 5000 },    // Hold peak
        { duration: '1m', target: 10000 },   // Stage 3: Stress
        { duration: '2m', target: 10000 },   // Hold stress
        { duration: '1m', target: 0 },       // Ramp down
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // At stress levels, we relax thresholds — the goal is to find
    // where the system breaks, not to enforce SLAs
    'http_req_failed': ['rate<0.20'],  // < 20% hard errors (excluding 429)
    'stress_auth_error': ['rate<0.10'], // < 10% 500 errors
  },
  tags: {
    test: 'veriface-stress-10k',
    target: TARGET_URL,
  },
}

export default function () {
  activeVUs.add(__VU)

  const userId = `stress_user_${__VU}_${__ITER}_${Date.now()}`

  const res = http.post(
    `${TARGET_URL}/api/session/init`,
    JSON.stringify({
      tenantId: TEST_TENANT_ID,
      flow: 'authenticate',
      externalUserId: userId,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_API_KEY}`,
      },
      tags: { name: 'session_init' },
    }
  )

  initLatency.add(res.timings.duration)

  if (res.status === 200) {
    const body = JSON.parse(res.body || '{}')
    authSuccess.add(body.success === true)
  } else if (res.status === 429) {
    rateLimit429.add(1)
    authRejected.add(1)
  } else {
    authError.add(1)
    if (__ITER < 10) {
      console.warn(`Unexpected: HTTP ${res.status} - ${res.body?.slice(0, 200)}`)
    }
  }

  // Very short think time for stress testing (max throughput)
  sleep(0.1)
}

export function handleSummary(data) {
  const summary = {
    test: 'veriface-stress-10k',
    timestamp: new Date().toISOString(),
    target: TARGET_URL,
    metrics: {
      totalRequests: data.metrics.http_reqs?.values?.count || 0,
      avgLatency: data.metrics.http_req_duration?.values?.avg?.toFixed(2) || 0,
      p50Latency: data.metrics.http_req_duration?.values?.['p(50)']?.toFixed(2) || 0,
      p95Latency: data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) || 0,
      p99Latency: data.metrics.http_req_duration?.values?.['p(99)']?.toFixed(2) || 0,
      errorRate: ((data.metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2),
      rateLimitHits: data.metrics.stress_429_count?.values?.count || 0,
      iterations: data.metrics.iterations?.values?.count || 0,
      peakVUs: data.metrics.vus_max?.values?.max || 0,
    },
    thresholds: data.metrics,
  }

  return {
    'tests/load/stress-results.json': JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(summary.metrics, null, 2),
  }
}
