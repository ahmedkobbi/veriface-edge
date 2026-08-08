# VeriFace Edge — System Description (SOC 2)

## Overview

VeriFace Edge is a privacy-first, cloud-native facial authentication SaaS platform. All biometric computation (face detection, rPPG, PAD, embedding) runs on-device in the client SDK — the backend never receives raw face images, embeddings, or biometric signals. Only zero-knowledge cryptographic proofs are transmitted.

## System Scope

### In Scope for SOC 2

| Component | Technology | Hosting |
|-----------|-----------|---------|
| Web application (Next.js 16) | TypeScript, React, Tailwind CSS | AWS ECS / Vercel |
| API server (Next.js API routes) | 66 REST endpoints | AWS ECS / Vercel |
| Database | PostgreSQL 16 (production), SQLite (dev) | AWS RDS |
| Audit log | PostgreSQL (hash-chained, 7-year retention) | AWS RDS |
| Email queue | PostgreSQL (EmailLog table) + SMTP (SES) | AWS RDS + SES |
| WebSocket server | Socket.io | AWS ECS |
| CDN (SDK distribution) | Cloudflare | Cloudflare |
| DNS | Cloudflare | Cloudflare |
| TLS termination | Caddy (HTTP/3, QUIC) | AWS ECS |
| Container registry | GitHub Container Registry | GitHub |
| Source code | GitHub | GitHub |
| CI/CD | GitHub Actions | GitHub |
| Backups | S3 (KMS-encrypted) | AWS S3 |
| Billing | Stripe + NowPayments | Third-party SaaS |

### Out of Scope

| Component | Reason |
|-----------|--------|
| Client SDKs (Web, iOS, Android, Flutter, React Native) | Runs on user devices — not under VeriFace's control. Security is the SDK's responsibility. |
| Cloud provider infrastructure (AWS, Cloudflare) | Covered by their own SOC 2 reports. |
| Stripe | Covered by Stripe's SOC 2 Type II report. |
| NowPayments | Covered by NowPayments' compliance program. |
| GitHub | Covered by GitHub's SOC 2 Type II report. |

## System Boundaries

### Trust Boundary 1: Client ↔ Backend API
- **Authentication**: API key (Bearer token) + HMAC request signing (timestamp + nonce + signature)
- **Transport security**: TLS 1.3 (HTTP/3 via Caddy), HSTS preload-ready
- **Certificate pinning**: SPKI SHA-256 pinning on iOS + Android SDKs
- **Rate limiting**: Per-minute (10-1000/min by plan tier) + monthly quota (1K-100K by plan tier)
- **Input validation**: Zod schemas on all endpoints
- **Body size limits**: Per-route (4KB-1MB)
- **Output**: PII redaction in error messages

### Trust Boundary 2: Backend API ↔ Database
- **Connection**: TLS-encrypted PostgreSQL connection
- **Authentication**: Database credentials from environment variables (AWS Secrets Manager in production)
- **Authorization**: Prisma ORM enforces tenant isolation (every query scoped to `tenantId`)
- **Encryption at rest**: AWS EBS encryption

### Trust Boundary 3: Backend ↔ External Services
- **Stripe**: API key authentication + webhook signature verification
- **NowPayments**: API key + HMAC-SHA256 webhook verification
- **Email (SES)**: IAM role-based authentication
- **S3 backups**: KMS-encrypted, IAM-scoped access

## Data Flow

```
User Device (SDK)
    │
    │ 1. POST /api/session/init (API key auth)
    │    ← Returns: sessionId, challenge, backendPubKey, experiment
    │
    │ 2. Camera capture (ALL on-device: face detection, rPPG, PAD, embedding)
    │    - MediaPipe face detection (Web SDK)
    │    - Vision face detection (iOS)
    │    - ML Kit face detection (Android)
    │    - CHROM rPPG algorithm (heart rate from skin color)
    │    - LBP PAD (presentation attack detection)
    │    - CoreML/TFLite face embedding (512-dim, L2-normalized)
    │
    │ 3. ZK proof generation (PLONK zk-SNARK)
    │    - Proves: "I know an embedding that hashes to commitment"
    │    - WITHOUT revealing the embedding
    │
    │ 4. Encrypt embedding (AES-256-GCM with X25519 ECDH session key)
    │
    │ 5. Sign JWT (Ed25519 + ML-DSA-87 hybrid signature)
    │
    │ 6. POST /api/session/verify (API key auth + HMAC sig)
    │    Body: { jwt, encryptedEmbedding, zkProof, commitment, liveness, antiInjection }
    │
    ▼
Backend API
    │
    ├── Verify API key (SHA-256 hash lookup + constant-time comparison)
    ├── Verify HMAC request signature (replay protection)
    ├── Verify JWT signature (Ed25519 + ML-DSA-87 hybrid)
    ├── Verify ZK proof (PLONK verification, ~15ms)
    ├── Decrypt embedding (AES-256-GCM with session ECDH key)
    ├── Compute cosine similarity (threshold: 0.78)
    ├── Issue auth token (Ed25519-signed JWT, 5-min expiry)
    ├── Append to audit log (hash-chained, tamper-evident)
    ├── Enqueue webhook (HMAC-signed delivery)
    └── Increment monthly usage counter
    │
    ▼
PostgreSQL Database
    ├── BiometricTemplate (encrypted embedding, never plaintext)
    ├── AuditLog (hash-chained, 7-year retention)
    ├── Session (ephemeral, 60-second expiry)
    └── Subscription/Invoice/Payment (billing)
```

## Security Controls Summary

| Category | Controls |
|----------|----------|
| **Authentication** | API keys (SHA-256 hashed), bcrypt passwords (10 rounds), 2FA/TOTP, SAML SSO, WebAuthn/FIDO2 |
| **Authorization** | RBAC (user, admin), API key scoping, tenant isolation, per-route auth checks |
| **Encryption** | TLS 1.3 in transit, AES-256-GCM at rest, X25519 ECDH session keys, Ed25519 + ML-DSA-87 signatures |
| **Zero-knowledge** | PLONK zk-SNARK proofs (backend never sees embedding) |
| **Audit logging** | Hash-chained, tamper-evident, 7-year retention, real-time streaming via WebSocket |
| **Rate limiting** | Per-minute (10-1000/min) + monthly quota (1K-100K/unlimited by plan tier) |
| **Input validation** | Zod schemas on all endpoints, body size limits, PII redaction |
| **Anti-injection** | 6-layer defense: virtual cam detection, timing jitter, BLAKE3 replay filter, micro-strobe probe, extension tamper check, hardware attestation |
| **Backup** | AES-256-GCM encrypted, SHA-256 integrity, S3 offsite, 30-day retention |
| **Disaster recovery** | Multi-region failover, RTO: 15 min, RPO: 5 min |
| **Vulnerability management** | Dependabot, CodeQL, `bun audit` in CI, black-hat security audits |
| **Change management** | PR review, CI/CD pipeline, conventional commits, release workflow |
