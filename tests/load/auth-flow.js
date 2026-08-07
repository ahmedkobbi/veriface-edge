/**
 * k6 Load Testing Script for VeriFace Edge
 *
 * Run with: k6 run tests/load/auth-flow.js --env API_KEY=vf_live_...
 *
 * Simulates 100 concurrent users running the session init flow.
 * Measures latency, success rate, and rate limiting behavior.
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Trend } from 'k6/metrics'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const TENANT_API_KEY = __ENV.API_KEY || ''

const sessionInitDuration = new Trend('session_init_duration_ms')
const authSuccess = new Counter('auth_success_total')
const authFailure = new Counter('auth_failure_total')

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    session_init_duration_ms: ['p(95)<200'],
  },
}

export default function () {
  const healthRes = http.get(`${BASE_URL}/api/health`)
  check(healthRes, {
    'health 200': (r) => r.status === 200,
  })

  const initStart = Date.now()
  const initRes = http.post(
    `${BASE_URL}/api/session/init`,
    JSON.stringify({
      flow: 'authenticate',
      externalUserId: `load-user-${__VU}-${__ITER}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TENANT_API_KEY}`,
      },
    },
  )
  sessionInitDuration.add(Date.now() - initStart)

  const ok = check(initRes, {
    'session init 200': (r) => r.status === 200,
    'has challenge': (r) => r.json('challenge') !== undefined,
  })

  if (ok) {
    authSuccess.add(1)
  } else {
    authFailure.add(1)
  }

  sleep(0.5)
}
