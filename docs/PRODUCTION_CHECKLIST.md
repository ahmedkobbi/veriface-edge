# VeriFace Edge — Production Deployment Checklist

**Classification**: Confidential — DevOps Team
**Last reviewed**: 2026-08-07

---

## Pre-Deployment

### Environment Variables
- [ ] `DATABASE_URL` — PostgreSQL connection string (NOT SQLite in production)
- [ ] `VERIFACE_SERVER_SIGNING_KEY` — 64 hex chars (Ed25519 private key)
- [ ] `VERIFACE_ENCRYPTION_KEY` — 64 hex chars (AES-256 master key)
- [ ] `CRON_SECRET` — shared secret for cron job endpoints
- [ ] `VERIFACE_ALLOWED_ORIGINS` — comma-separated list of client domains
- [ ] `WEBAUTHN_RP_ID` — your domain (e.g., `veriface.io`)
- [ ] `WEBAUTHN_RP_ORIGIN` — `https://veriface.io`
- [ ] `OIDC_ISSUER` — `https://veriface.io`
- [ ] `SITE_URL` — `https://veriface.io`
- [ ] `NODE_ENV=production`

### TLS / HTTP
- [ ] TLS 1.3 certificate obtained (Let's Encrypt or commercial CA)
- [ ] HTTP/3 (QUIC) enabled — UDP port 443 open on firewall
- [ ] HSTS preload submission (https://hstspreload.org)
- [ ] OCSP stapling enabled
- [ ] Certificate auto-renewal configured
- [ ] HTTP → HTTPS redirect (port 80 → 443)

### DNS
- [ ] A record for `veriface.io` → server IP
- [ ] A record for `api.veriface.io` → server IP
- [ ] AAAA record (IPv6) if supporting IPv6
- [ ] CAA record restricting certificate authorities

### Database
- [ ] PostgreSQL 16+ provisioned
- [ ] Connection pooling configured (PgBouncer or built-in)
- [ ] Daily encrypted backups enabled (`scripts/backup-db.sh`)
- [ ] Backup restoration tested
- [ ] Database user has minimal privileges (no superuser)
- [ ] `bun run db:push` run successfully

### Secrets Management
- [ ] All secrets stored in AWS KMS / HashiCorp Vault (NOT .env file)
- [ ] Secrets rotation schedule documented (`docs/SECRETS_ROTATION.md`)
- [ ] Emergency rotation procedure tested
- [ ] No secrets in version control (`.gitignore` includes `.env`)

---

## Deployment

### Application
- [ ] `bun run build` succeeds without errors
- [ ] `bun run lint` passes with 0 errors
- [ ] `bun test` — all 113 tests pass
- [ ] Source maps disabled in production (`productionBrowserSourceMaps: false`)
- [ ] `poweredByHeader: false` (hide Next.js version)
- [ ] Bundle size analyzed (`ANALYZE=true bun run build`)
- [ ] No `console.log` in production code (use structured logger)

### Infrastructure
- [ ] Docker image built and pushed to registry
- [ ] Kubernetes manifest deployed (if using k8s)
- [ ] Health check endpoint responds 200 (`/api/health`)
- [ ] Readiness probe configured
- [ ] Liveness probe configured
- [ ] Resource limits set (CPU + memory)
- [ ] Horizontal pod autoscaler configured (min 2, max 10 replicas)
- [ ] Pod disruption budget set (minAvailable: 1)

### Networking
- [ ] Caddy/nginx reverse proxy configured with HTTP/3
- [ ] Rate limiting enabled at proxy layer
- [ ] Request body size limit (10MB)
- [ ] WebSocket upgrade supported (for Socket.io)
- [ ] Gzip + Brotli compression enabled
- [ ] Security headers verified (https://securityheaders.com)

### WebSocket Server
- [ ] Mini-service running on port 3001
- [ ] WebSocket health check passes (`/health`)
- [ ] Connection limit per tenant enforced (50)
- [ ] Rate limiting per connection (100 msgs/min)
- [ ] CORS origin allowlist configured

---

## Security Verification

### Headers
- [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY`
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy: camera=(self), microphone=(), ...`
- [ ] `Content-Security-Policy` with Trusted Types
- [ ] `Cross-Origin-Opener-Policy: same-origin`
- [ ] `Cross-Origin-Embedder-Policy: require-corp`
- [ ] `Alt-Svc: h3=":443"; ma=86400` (HTTP/3 advertisement)
- [ ] No `X-Powered-By` header
- [ ] No `Server` header (or generic value)

### API Security
- [ ] All endpoints require API key (except `/api/tenant` bootstrap and `/api/health`)
- [ ] Rate limiting active (60 req/min per tenant+IP)
- [ ] Zod input validation on every endpoint
- [ ] SSRF protection on webhook URLs
- [ ] HMAC request signing on `/session/verify`
- [ ] Constant-time API key comparison
- [ ] PII redaction in error messages
- [ ] Request body size limits enforced

### Cryptography
- [ ] Ed25519 for JWT signing (key from env, not runtime)
- [ ] X25519 ECDH for session key exchange
- [ ] AES-256-GCM for embedding encryption
- [ ] BLAKE3 for Pedersen commitments + frame hashing
- [ ] HKDF-SHA256 for key derivation
- [ ] HMAC-SHA256 for webhook signing + request signing
- [ ] No custom crypto (all from @noble/curves/hashes/ciphers)

### Compliance
- [ ] GDPR Art. 7 (consent recording) endpoint working
- [ ] GDPR Art. 17 (right to be forgotten) endpoint working
- [ ] GDPR Art. 20 (data portability) endpoint working
- [ ] GDPR Art. 5(1)(e) (retention policy) cron configured
- [ ] Audit log hash chain integrity verified
- [ ] BIPA compliance (no face geometry stored)
- [ ] ISO/IEC 30107-3 certification in progress

---

## Monitoring

### Metrics
- [ ] Prometheus scraping `/api/metrics`
- [ ] Grafana dashboard imported (`docs/grafana-dashboard.json`)
- [ ] Alert rules deployed (`docs/prometheus-alerts.yml`)
- [ ] Alert routing configured (PagerDuty / Slack / email)

### Logging
- [ ] Structured JSON logging (pino) to stdout
- [ ] Log aggregation configured (ELK / Datadog / CloudWatch)
- [ ] Sensitive data redaction verified (28 redaction paths)
- [ ] Request ID correlation across all logs
- [ ] Log retention policy set (90 days hot, 7 years cold for audit)

### Health Checks
- [ ] `/api/health` checks: database, memory, WebSocket, process
- [ ] External monitoring (Pingdom / UptimeRobot) configured
- [ ] SSL certificate expiry monitoring
- [ ] DNS monitoring
- [ ] HTTP/3 connectivity monitoring

---

## Post-Deployment

### Smoke Tests
- [ ] Tenant creation: `POST /api/tenant` returns 200 with API key
- [ ] Session init: `POST /api/session/init` returns 200 with challenge
- [ ] Audit log: `GET /api/audit` returns hash-chained entries
- [ ] Audit export: `GET /api/audit/export?format=csv` returns CSV
- [ ] Health check: `GET /api/health` returns 200 with all checks "ok"
- [ ] Metrics: `GET /api/metrics` returns Prometheus format
- [ ] OIDC discovery: `GET /.well-known/openid-configuration` returns config
- [ ] WebSocket: `GET http://localhost:3001/health` returns 200

### Performance
- [ ] p95 latency < 500ms for API routes
- [ ] p99 latency < 1s for API routes
- [ ] Auth flow completes in < 2s end-to-end
- [ ] No memory leaks under sustained load
- [ ] Load test passed (k6 script: `tests/load/auth-flow.js`)

### Documentation
- [ ] `README.md` updated
- [ ] `docs/THREAT_MODEL.md` reviewed
- [ ] `docs/SECRETS_ROTATION.md` distributed to on-call team
- [ ] `docs/BRAND_GUIDELINES.md` distributed to design team
- [ ] Runbook created for common incidents
- [ ] On-call schedule configured

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| DevOps Lead | | | |
| Security Lead | | | |
| Engineering Lead | | | |

---

## Emergency Contacts

- **On-call engineer**: +1-XXX-XXX-XXXX
- **Security incidents**: security@veriface.io
- **PagerDuty**: https://veriface.pagerduty.com
- **Status page**: https://status.veriface.io
