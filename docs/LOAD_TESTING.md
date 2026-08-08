# VeriFace Edge — Load Testing + Performance Runbook

## Overview

This document describes the load testing strategy, scripts, and performance optimization for VeriFace Edge.

---

## 🎯 Performance Targets

| Metric | Target | Acceptable | Failure |
|--------|--------|-----------|---------|
| **Session Init P50** | < 100ms | < 200ms | > 500ms |
| **Session Init P95** | < 200ms | < 500ms | > 1000ms |
| **Session Init P99** | < 500ms | < 1000ms | > 2000ms |
| **Session Verify P50** | < 500ms | < 1000ms | > 2000ms |
| **Session Verify P95** | < 1000ms | < 2000ms | > 5000ms |
| **Session Verify P99** | < 2000ms | < 5000ms | > 10000ms |
| **Error Rate** | < 1% | < 5% | > 10% |
| **Rate Limit Hit Rate** | < 1% | < 5% | > 20% |
| **Concurrent Users** | 10,000 | 5,000 | < 1,000 |

---

## 📊 Test Scenarios

### Scenario 1: Session Init (Lightweight)

Tests the `/api/session/init` endpoint under load. This is the hot path — every authentication starts here.

```bash
k6 run tests/load/k6-session-flow.js --env SCENARIO=init --env VUS=10000 --env DURATION=5m
```

**What it tests:**
- API key authentication (cached in Redis)
- Rate limiting (Redis-based)
- Database session creation
- Tenant config lookup (cached)

**Expected bottlenecks:**
- Database connection pool exhaustion (if pool < 50)
- Rate limit cache contention (if Redis not configured)

### Scenario 2: Session Verify (Heavyweight)

Tests the `/api/session/verify` endpoint. This is the heaviest path — crypto + ZK + DB.

```bash
k6 run tests/load/k6-session-flow.js --env SCENARIO=verify --env VUS=1000 --env DURATION=5m
```

**What it tests:**
- Ed25519 + ML-DSA-87 signature verification (crypto)
- AES-256-GCM embedding decryption
- PLONK ZK proof verification (~15ms)
- Cosine similarity computation
- Audit log append (hash chain)

**Expected bottlenecks:**
- ZK proof verification CPU time (~15ms per proof)
- Crypto operations (Ed25519 verify ~0.2ms, ML-DSA-87 verify ~1ms)
- Database write for audit log

### Scenario 3: Mixed (Realistic)

80% init, 20% verify — simulates real user behavior.

```bash
k6 run tests/load/k6-session-flow.js --env SCENARIO=mixed --env VUS=5000 --env DURATION=10m
```

### Scenario 4: Stress Test (10K Concurrent)

Breakpoint test — finds where the system fails.

```bash
k6 run tests/load/k6-stress-10k.js --env TARGET_URL=https://api.veriface.io
```

**Stages:**
1. 1K VUs (normal load) — 2 min
2. 5K VUs (peak load) — 3 min
3. 10K VUs (stress) — 3 min
4. Ramp down — 1 min

**Expected behavior at 10K VUs:**
- P95 latency may exceed 2000ms (acceptable under stress)
- Rate limiting kicks in (429 responses expected)
- System should NOT crash — graceful degradation
- No 500 errors (all errors should be 429 or 401)

---

## 🔍 Bottleneck Identification

### Layer 1: Database

**Symptoms:** High P99 latency, connection pool errors, slow queries

**Diagnosis:**
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Check slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check index usage
SELECT relname, seq_scan, seq_tuples_read, idx_scan, idx_tuples_fetch
FROM pg_stat_user_tables
ORDER BY seq_tuples_read DESC;
```

**Mitigation:**
- Increase connection pool size (`DATABASE_POOL_SIZE=50`)
- Add indexes on hot columns (already done: `ApiKey.keyHash`, `Tenant.id`, `AuditLog.tenantId`)
- Enable Redis caching for API key + tenant lookups (already implemented)

### Layer 2: Crypto

**Symptoms:** High CPU usage, slow verify endpoint

**Diagnosis:**
```bash
# Profile crypto operations
curl -sS http://localhost:3000/api/metrics | grep veriface_crypto
```

**Expected latencies:**
| Operation | Time | Notes |
|-----------|------|-------|
| Ed25519 verify | ~0.2ms | Fast |
| ML-DSA-87 verify | ~1ms | Post-quantum (larger key) |
| AES-256-GCM decrypt | ~0.1ms | Hardware-accelerated (AES-NI) |
| BLAKE3 hash | ~0.05ms | Very fast |
| PLONK verify | ~15ms | Bottleneck — pairing check |

**Mitigation:**
- ZK proof verification is the primary bottleneck (~15ms)
- Use a ZK proof cache: skip re-verification if the same proof was recently verified
- Batch verify: process multiple proofs in parallel (worker pool)
- Consider PLONK verification in WebAssembly (faster than JS)

### Layer 3: ZK Proof Verification

**Symptoms:** Verify endpoint P95 > 2000ms

**Diagnosis:**
```bash
# Check ZK verification metrics
curl -sS http://localhost:3000/api/metrics | grep veriface_zk
```

**Mitigation:**
- Cache the verification key in memory (already implemented — L1 cache)
- Cache recent proof results (proof hash → valid/invalid, TTL: 5 min)
- Offload ZK verification to a separate worker thread
- Use GPU acceleration for pairing checks (experimental)

### Layer 4: Rate Limiting

**Symptoms:** 429 responses at low load, inconsistent rate limits across instances

**Diagnosis:**
```bash
# Check rate limit cache stats
curl -sS http://localhost:3000/api/metrics | grep veriface_rate_limit
```

**Mitigation:**
- Use Redis for rate limiting (already implemented — `checkCachedRateLimit`)
- Redis INCR is atomic — works across multiple instances
- In-memory fallback for single-instance dev mode

### Layer 5: Network

**Symptoms:** High latency on all endpoints, TCP retransmissions

**Diagnosis:**
```bash
# Check network latency
ping api.veriface.io
curl -o /dev/null -s -w "Connect: %{time_connect}\nTTFB: %{time_starttransfer}\nTotal: %{time_total}\n" https://api.veriface.io/api/health
```

**Mitigation:**
- Use HTTP/3 (QUIC) via Caddy (already configured)
- Enable keep-alive connections
- Use Cloudflare CDN for static assets
- Deploy closer to users (multi-region)

---

## 🚀 Redis Caching Architecture

### 3-Layer Cache

```
Request → L1 (In-Memory LRU) → L2 (Redis) → L3 (Database)
              ~0ms                ~1ms           ~5-10ms
```

| Cache | Size | TTL | Invalidation |
|-------|------|-----|-------------|
| **API Key** | 500 entries | 5 min | On revoke |
| **Tenant Config** | 100 entries | 5 min | On plan change |
| **ZK Verification Key** | 1 entry | 1 hour | On re-ceremony |
| **Monthly Usage** | 1000 entries | 1 min | Write-through |
| **Rate Limit Bucket** | Per IP+tenant | 60s | Automatic (window expiry) |

### Cache Hit Rate Targets

| Cache | Target Hit Rate | Impact if Miss |
|-------|----------------|----------------|
| API Key | > 99% | DB query (~5ms) |
| Tenant Config | > 95% | DB query (~5ms) |
| ZK VKey | > 99.9% | File read (~2ms) |
| Rate Limit | > 99% | In-memory fallback |
| Monthly Usage | > 90% | DB query (~5ms) |

### Redis Configuration

```bash
# .env
REDIS_URL=redis://redis:6379

# docker-compose.yml (already configured)
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --appendonly yes
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data
```

### Cache Invalidation

All cache invalidations are event-driven (not just TTL-based):

| Event | Cache Invalidated | Method |
|-------|-------------------|--------|
| API key revoked | `apikey:{keyHash}` | `invalidateApiKeyCache()` |
| API key created | None (new key, no stale cache) | N/A |
| Tenant plan changed | `tenant:{tenantId}` | `invalidateTenantCache()` |
| Tenant config updated | `tenant:{tenantId}` | `invalidateTenantCache()` |
| ZK key regenerated | `zk:vkey` | Process restart (key is immutable) |

---

## 📈 Monitoring

### Prometheus Metrics

The following metrics are exposed at `/api/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `veriface_http_request_duration_seconds` | Histogram | HTTP request latency |
| `veriface_auth_attempts_total` | Counter | Auth attempts (by outcome) |
| `veriface_rate_limit_hits_total` | Counter | Rate limit hits (by reason) |
| `veriface_crypto_operation_duration_seconds` | Histogram | Crypto operation latency |
| `veriface_enrollments_total` | Counter | Enrollments (by variant, outcome) |
| `veriface_active_sessions` | Gauge | Active sessions |
| `veriface_injection_suspected_total` | Counter | Injection attempts detected |

### Grafana Dashboard

Import the dashboard from `docs/grafana-dashboard.json` (if available) or create panels for:

1. **Request latency** (P50, P95, P99) — by endpoint
2. **Error rate** — by status code
3. **Throughput** — requests per second
4. **Rate limit hits** — by tenant
5. **Crypto operation duration** — by operation type
6. **ZK verification duration** — histogram
7. **Cache hit rate** — by cache type
8. **Database connections** — active vs. pool size
9. **Redis operations** — ops/sec, memory usage

### Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| HighLatency | P95 > 1000ms for 5 min | SEV-2 |
| HighErrorRate | 5xx rate > 5% for 5 min | SEV-2 |
| RateLimitSpike | 429 rate > 20% for 5 min | SEV-3 |
| DatabaseConnectionsHigh | Active connections > 80% of pool | SEV-3 |
| RedisDown | Redis connection failed | SEV-2 |
| ZKVerifySlow | ZK verify P95 > 50ms | SEV-3 |

---

## 🧪 Running Load Tests

### Prerequisites

1. **Install k6**:
   ```bash
   # macOS
   brew install k6

   # Linux
   sudo gpg -k
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A36442D57C5C3EC0934DC5DAA
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt update
   sudo apt install k6
   ```

2. **Create test tenant + API key**:
   ```bash
   curl -X POST http://localhost:3000/api/tenant -d '{"name":"Load Test Tenant"}'
   # Save the API key from the response
   ```

3. **Set up Redis** (for multi-instance testing):
   ```bash
   docker-compose up -d redis
   ```

### Running the Tests

```bash
# Set environment variables
export TARGET_URL=http://localhost:3000
export TEST_API_KEY=vf_live_your_test_key
export TEST_TENANT_ID=your_test_tenant_id

# Scenario 1: Init only (lightweight)
k6 run tests/load/k6-session-flow.js --env SCENARIO=init --env VUS=1000 --env DURATION=2m

# Scenario 2: Verify only (heavyweight)
k6 run tests/load/k6-session-flow.js --env SCENARIO=verify --env VUS=200 --env DURATION=5m

# Scenario 3: Mixed (realistic)
k6 run tests/load/k6-session-flow.js --env SCENARIO=mixed --env VUS=1000 --env DURATION=5m

# Scenario 4: Stress test (10K concurrent)
k6 run tests/load/k6-stress-10k.js

# Against production (with auth)
k6 run tests/load/k6-session-flow.js --env TARGET_URL=https://api.veriface.io --env TEST_API_KEY=vf_live_prod_key
```

### Interpreting Results

| Metric | Good | Warning | Bad |
|--------|------|---------|-----|
| P50 latency | < 100ms | 100-500ms | > 500ms |
| P95 latency | < 500ms | 500-2000ms | > 2000ms |
| P99 latency | < 1000ms | 1000-5000ms | > 5000ms |
| Error rate | < 1% | 1-5% | > 5% |
| 429 rate | < 1% | 1-10% | > 10% |
| 500 rate | 0% | 0-1% | > 1% |
| Throughput | > 1000 req/s | 100-1000 req/s | < 100 req/s |

---

## 📋 Performance Optimization Checklist

- [x] Redis caching for API key lookups (L1 + L2)
- [x] Redis caching for tenant config (L1 + L2)
- [x] Redis caching for ZK verification key (L1 + L2)
- [x] Redis-based rate limiting (atomic INCR)
- [x] In-memory LRU fallback (single-instance dev)
- [x] Cache invalidation on revoke/plan change
- [x] HTTP/3 (QUIC) via Caddy
- [x] Database indexes on all hot columns
- [x] Connection pooling (Prisma)
- [x] Prometheus metrics for all operations
- [ ] ZK proof result cache (skip re-verification of same proof)
- [ ] Worker pool for ZK verification (parallel processing)
- [ ] Read replicas for audit log queries (offload from primary)
- [ ] CDN edge caching for public keys (SDK)
- [ ] Request batching (multiple sessions in one request)
