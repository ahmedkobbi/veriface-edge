<div align="center">

# VeriFace Edge

### Privacy-First Facial Authentication Platform with Post-Quantum Security

[![CI](https://github.com/ahmedkobbi/veriface/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ahmedkobbi/veriface/actions/workflows/ci.yml)
[![CD](https://github.com/ahmedkobbi/veriface/actions/workflows/cd.yml/badge.svg)](https://github.com/ahmedkobbi/veriface/actions/workflows/cd.yml)
[![Security](https://img.shields.io/badge/security-military--grade-success?logo=shield&logoColor=white)](docs/OWASP_TOP10_FINAL.md)
[![OWASP](https://img.shields.io/badge/OWASP%20Top%2010-10%2F10%20PASS-brightgreen)](docs/OWASP_TOP10_FINAL.md)
[![License: MIT](https://img.shields.io/github/license/ahmedkobbi/veriface?color=blue)](LICENSE)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Bun](https://img.shields.io/badge/Bun-1.3%2B-fafafa?logo=bun&logoColor=black)](https://bun.sh/)
[![Docker](https://img.shields.io/badge/Docker-production%20ready-2496ED?logo=docker&logoColor=white)](Dockerfile)
[![K8s](https://img.shields.io/badge/Kubernetes-ready-326CE5?logo=kubernetes&logoColor=white)](k8s/)

[![SDKs](https://img.shields.io/badge/SDKs-8%20platforms-orange)](src/sdk/PLATFORMS.md)
[![Post-Quantum](https://img.shields.io/badge/Post--Quantum-ML--DSA--87%20%7C%20FIPS%20204-blueviolet)](src/lib/post-quantum-server.ts)
[![FIPS 140-3](https://img.shields.io/badge/FIPS%20140--3-ready-purple)](src/lib/fips/index.ts)
[![ZK Proofs](https://img.shields.io/badge/ZK-PLONK%20%7C%20snarkjs-ff69b4)](src/lib/attribute-proofs.ts)
[![SOC 2](https://img.shields.io/badge/SOC%202-Type%20II%20ready-teal)](docs/soc2/CONTROL_MATRIX.md)

[![Tests](https://img.shields.io/badge/tests-345%20passing-brightgreen)](tests/)
[![Findings Fixed](https://img.shields.io/badge/findings%20fixed-88%2F88-success)](docs/OWASP_TOP10_FINAL.md)
[![Stars](https://img.shields.io/github/stars/ahmedkobbi/veriface?style=social)](https://github.com/ahmedkobbi/veriface/stargazers)

</div>

---

> **No raw facial images ever leave the device.** The backend receives only a zero-knowledge Pedersen commitment, an end-to-end encrypted embedding, and a server-signed JWT. Even if the server is fully compromised, your face cannot be reconstructed.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Security Posture](#security-posture)
- [SDKs](#sdks)
- [Quick Start](#quick-start)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

VeriFace Edge is a complete, production-ready facial authentication SaaS platform. It combines on-device biometric computation, post-quantum cryptography, zero-knowledge proofs, and military-grade security hardening to deliver authentication that is private by design.

### What Makes It Different

| Feature | VeriFace Edge | Traditional Face Auth |
|---------|:---:|:---:|
| Face data leaves device | ❌ Never | ✅ Usually |
| Post-quantum signatures (ML-DSA-87) | ✅ FIPS 204 | ❌ |
| Zero-knowledge proofs (PLONK) | ✅ snarkjs | ❌ |
| Server-side signing proxy | ✅ Private key never leaves server | ❌ |
| FIPS 140-3 self-tests | ✅ NIST KAT vectors | ❌ |
| Hash-chained audit log | ✅ Tamper-evident | ❌ |
| GDPR crypto-erasure | ✅ Art. 17 | ❌ |
| 8 SDKs (Web, RN, iOS, Android, Flutter, Python, Go, Rust) | ✅ | ❌ |
| OWASP Top 10 compliance | ✅ 10/10 PASS | ❌ |
| MPC ceremony (Perpetual Powers of Tau) | ✅ | ❌ |

---

## Architecture

```
                          ┌─────────────────────────────────────────────┐
                          │                  Device                     │
                          │  ┌───────────────────────────────────────┐  │
    Camera ──────────────►│  │  SDK (Web/iOS/Android/Flutter/RN)     │  │
                          │  │  ┌─────┐ ┌──────┐ ┌─────┐ ┌────────┐ │  │
                          │  │  │rPPG │ │ PAD  │ │Embed│ │Anti-Inj│ │  │
                          │  │  │CHROM│ │ LBP  │ │ding │ │ 6-layer│ │  │
                          │  │  └──┬──┘ └──┬───┘ └──┬──┘ └───┬────┘ │  │
                          │  │     │       │        │         │      │  │
                          │  │  ┌──┴───────┴────────┴─────────┴──┐   │  │
                          │  │  │  Crypto: Ed25519 + X25519 ECDH  │   │  │
                          │  │  │  AES-256-GCM + BLAKE3 + HKDF    │   │  │
                          │  │  │  Pedersen Commitment (ZK)       │   │  │
                          │  │  └──────────────┬──────────────────┘   │  │
                          │  └─────────────────┼──────────────────────┘  │
                          └────────────────────┼────────────────────────┘
                                               │
                          Encrypted payload    │  JWT (server-signed via /api/session/sign)
                          + commitment + scores│  Private key NEVER leaves server
                                               ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                          Backend (Next.js)                           │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐ │
  │  │ Session  │→ │ Verify   │→ │ Match    │→ │ Issue Token (JWT)   │ │
  │  │ Init     │  │ JWT sig  │  │ Cosine   │  │ Ed25519-signed      │ │
  │  │ + ECDH   │  │ + ZK     │  │ sim ≥0.62│  │ 5-min expiry        │ │
  │  └──────────┘  └──────────┘  └──────────┘  └─────────────────────┘ │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐ │
  │  │ Audit    │  │ Rate     │  │ Billing  │  │ Webhook Delivery    │ │
  │  │ Hash chain│  │ Limit    │  │ Stripe+  │  │ HMAC-signed + retry │ │
  │  │ (SHA-256)│  │ (Redis)  │  │ NowPay   │  │ + circuit breaker   │ │
  │  └──────────┘  └──────────┘  └──────────┘  └─────────────────────┘ │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## Security Posture

### Audited & Remediated

| Audit Round | Findings | Status |
|-------------|----------|--------|
| Original black-hat pentest | 65 (12C + 15H + 18M + 12L + 8I) | ✅ All fixed |
| Re-pentest validation (35-yr veteran) | 0 new | ✅ Confirmed |
| Beast-level strict audit (50-yr veteran) | 11 new (3H + 5M + 3L) | ✅ All fixed |
| SDK + infrastructure audit | 6 new (1C + 2H + 2M + 1L) | ✅ All fixed |
| **Total** | **88 findings** | **88/88 fixed (100%)** |

### OWASP Top 10 (2021) — 10/10 PASS

| Category | Status |
|----------|:------:|
| A01 Broken Access Control | ✅ |
| A02 Cryptographic Failures | ✅ |
| A03 Injection | ✅ |
| A04 Insecure Design | ✅ |
| A05 Security Misconfiguration | ✅ |
| A06 Vulnerable Components | ✅ |
| A07 ID & Auth Failures | ✅ |
| A08 Software Integrity | ✅ |
| A09 Logging Failures | ✅ |
| A10 SSRF | ✅ |

### Cryptographic Stack

| Layer | Algorithm | Standard |
|-------|-----------|----------|
| JWT signing | Ed25519 (server-side proxy) | RFC 8032 |
| Post-quantum signing | ML-DSA-87 | FIPS 204 |
| Session key exchange | X25519 ECDH | RFC 7748 |
| Embedding encryption | AES-256-GCM | NIST SP 800-38D |
| Commitment + frame hash | BLAKE3 | — |
| Key derivation | HKDF-SHA256 | RFC 5869 |
| ZK proofs | PLONK (snarkjs) | — |
| Webhook signing | HMAC-SHA256 | — |
| API key hashing | SHA-256 | — |
| Field-level encryption | AES-256-GCM (FLE) | — |

### Server-Side Signing Proxy (S-02)

The tenant's Ed25519 private key is **encrypted at rest** and **never leaves the server**. The SDK sends unsigned JWT payloads to `/api/session/sign`, and the server signs them in-memory. This eliminates client-side key exposure (XSS, reverse-engineering) entirely.

---

## SDKs

| Platform | Package | Language | Status |
|----------|---------|----------|--------|
| Web | `@veriface/edge-sdk` | TypeScript | ✅ Production |
| React Native | `@veriface/edge-react-native` | TypeScript | ✅ Production |
| iOS | `VeriFaceEdge` (SPM) | Swift | ✅ Production |
| Android | `io.veriface:edge-sdk-android` | Kotlin | ✅ Production |
| Flutter | `veriface_edge` | Dart | ✅ Production |
| Python | `veriface-edge` | Python | ✅ Production |
| Go | `veriface-edge-go` | Go | ✅ Production |
| Rust | `veriface-edge-rs` | Rust | ✅ Production |

All SDKs implement identical crypto (verified by cross-platform tests):
- Ed25519 signing (via server proxy) + X25519 ECDH + AES-256-GCM + BLAKE3 + HKDF-SHA256
- Same API contract, same payload format, same security guarantees

---

## Quick Start

### 1. Install

```bash
git clone https://github.com/ahmedkobbi/veriface.git
cd veriface
bun install
```

### 2. Configure

```bash
cp .env.example .env

# Generate required keys
echo "VERIFACE_SERVER_SIGNING_KEY=$(openssl rand -hex 32)"
echo "VERIFACE_ENCRYPTION_KEY=$(openssl rand -hex 32)"

# Edit .env with your values
```

### 3. Run

```bash
bun run db:push    # Create database schema
bun run dev         # Start dev server
```

Visit `http://localhost:3000` — a demo tenant + API key is auto-provisioned.

### 4. Use the SDK

```tsx
import { useFaceAuth } from '@veriface/edge-sdk/react'

function LoginPage() {
  const { status, liveness, error, authenticate, videoRef } = useFaceAuth({
    tenantId: 'tnt_...',
    apiKey: 'vf_live_...',
    livenessThreshold: 0.78,
    captureDurationMs: 1800,
  })

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted />
      <button onClick={() => authenticate('user_123')}>
        Sign in with Face
      </button>
    </>
  )
}
```

### 5. Verify a Token (Server-Side)

```python
from veriface_edge import VeriFaceClient

client = VeriFaceClient(
    tenant_id="tnt_...",
    api_key="vf_live_...",
    api_base_url="https://api.veriface.io",
)

result = client.verify_token("eyJhbGci...")
print(f"Valid: {result.valid}")
print(f"Subject: {result.claims.sub}")
```

---

## Deployment

### Docker Compose (Single Host)

```bash
# 1. Create production env file
cp .env.example .env.production
# Edit .env.production — fill in ALL secrets

# 2. Place TLS certs
mkdir -p certs
cp /path/to/fullchain.pem certs/
cp /path/to/privkey.pem certs/

# 3. Deploy
./scripts/deploy.sh --build --env-file .env.production

# 4. Verify
./scripts/health-check.sh --url https://your-domain.com --docker
```

### Kubernetes (Multi-Host, Auto-Scaling)

```bash
# Quick deploy (see k8s/README.md for full guide)
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml    # Edit first!
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/migration-job.yaml
kubectl apply -f k8s/app.yaml
kubectl apply -f k8s/ingress.yaml
```

Features: 3 replicas, HPA (3-10 pods), PodDisruptionBudget, TLS via cert-manager, strict security headers, rate limiting, Sigstore-signed images, Trivy scanning.

### CI/CD Pipeline

| Workflow | Trigger | What It Does |
|----------|---------|-------------|
| **CI** | Every push/PR | Lint + type check + tests (2 shards) + security audit + CodeQL + Trivy + SBOM |
| **CD** | Push to main | Build + push to GHCR + Sigstore sign + deploy to staging (auto) or production (manual, 2 approvals) |
| **Release** | `git tag v*` | Versioned image + GitHub Release + changelog + SBOM |

---

## API Reference

### Core Authentication Flow

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
| `/api/tenant` | POST | bootstrap | Create tenant + API key |
| `/api/session/init` | POST | `session:init` | Initialize auth session |
| `/api/session/sign` | POST | `session:verify` | Server-side JWT signing (S-02) |
| `/api/session/verify` | POST | `session:verify` | Verify biometric payload + issue token |
| `/api/token/verify` | POST | `session:verify` | Relying-party token introspection |
| `/api/token/revoke` | POST | `session:verify` | Revoke token before expiry |

### Compliance & GDPR

| Endpoint | Method | Scope | Description |
|----------|--------|-------|-------------|
| `/api/consent` | POST | `session:init` | Record/withdraw consent (Art. 7) |
| `/api/templates/delete` | POST | `tenant:admin` | Crypto-erasure (Art. 17) |
| `/api/templates/export` | POST | `audit:read` | Data portability (Art. 20) |
| `/api/audit` | GET | `audit:read` | Hash-chained audit log |
| `/api/audit/export` | GET | `audit:read` | CSV/JSON export for compliance |

### Billing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/billing/checkout` | POST | Stripe Checkout session |
| `/api/billing/stripe/webhook` | POST | Stripe webhook (raw-body HMAC) |
| `/api/billing/nowpayments/webhook` | POST | NowPayments crypto webhook |
| `/api/billing/report-usage` | POST | Metered usage to Stripe |

Full OpenAPI spec: [`openapi.json`](openapi.json)

---

## Documentation

| Document | Description |
|----------|-------------|
| [OWASP Top 10 Final Status](docs/OWASP_TOP10_FINAL.md) | 10/10 categories PASS, 88 findings fixed |
| [Beast-Level Pentest Report](docs/BEAST_LEVEL_PENTEST.md) | 50-yr veteran strict audit (11 new findings) |
| [Re-Pentest Validation](docs/RE_PENTEST_REPORT.md) | 35-yr veteran validation (65 findings confirmed fixed) |
| [Threat Model (STRIDE)](docs/THREAT_MODEL.md) | Attack trees, residual risks |
| [FIPS 140-3 Certification](docs/fips/FIPS_140-3_CERTIFICATION.md) | Self-tests, boundary, provider abstraction |
| [SOC 2 Control Matrix](docs/soc2/CONTROL_MATRIX.md) | 58 controls, 95% implemented |
| [CI/CD Setup Guide](docs/CICD_SETUP.md) | Branch protection, environments, secrets |
| [Deployment Guide (k8s)](k8s/README.md) | Kubernetes production deployment |
| [Dependency Security](docs/DEPENDENCY_SECURITY.md) | Pinning, audit, CVE monitoring |
| [Brand Guidelines](docs/BRAND_GUIDELINES.md) | Logo, colors, typography |
| [Multi-Platform SDK Guide](src/sdk/PLATFORMS.md) | 8 SDKs compared |

---

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before opening a PR.

- 🐛 [Report a bug](https://github.com/ahmedkobbi/veriface/issues/new?labels=bug)
- ✨ [Request a feature](https://github.com/ahmedkobbi/veriface/issues/new?labels=enhancement)
- 🔒 [Report a security vulnerability](https://github.com/ahmedkobbi/veriface/security/advisories/new)
- 💬 [Start a discussion](https://github.com/ahmedkobbi/veriface/discussions)

Security-critical files require review from [CODEOWNERS](.github/CODEOWNERS).

---

## License

[MIT](LICENSE) — © 2026 Ahmed Kobbi

---

<div align="center">

**If this project helps you, please consider [⭐ starring the repo](https://github.com/ahmedkobbi/veriface/stargazers)!**

[![Star History Chart](https://api.star-history.com/svg?repos=ahmedkobbi/veriface&type=Date)](https://star-history.com/#ahmedkobbi/veriface&Date)

<sub>Built with Next.js · Prisma · Bun · @noble/curves · MediaPipe · snarkjs · Tailwind CSS</sub>

</div>
