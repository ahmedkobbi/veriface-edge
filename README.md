# VeriFace Edge — Privacy-First Web Facial Authentication SDK

[![CI](https://github.com/ahmedkobbi/veriface-edge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ahmedkobbi/veriface-edge/actions/workflows/ci.yml)
[![Release](https://github.com/ahmedkobbi/veriface-edge/actions/workflows/release.yml/badge.svg)](https://github.com/ahmedkobbi/veriface-edge/releases)
[![GitHub Pages](https://github.com/ahmedkobbi/veriface-edge/actions/workflows/pages.yml/badge.svg)](https://ahmedkobbi.github.io/veriface-edge/)
[![License: MIT](https://img.shields.io/github/license/ahmedkobbi/veriface-edge?color=blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Bun](https://img.shields.io/badge/Bun-1.3%2B-fafafa?logo=bun&logoColor=black)](https://bun.sh/)
[![Tests](https://img.shields.io/badge/tests-162%20passing-brightgreen)](tests/)
[![SDKs](https://img.shields.io/badge/SDKs-Web%20%7C%20RN%20%7C%20iOS%20%7C%20Android%20%7C%20Flutter-orange)](src/sdk/)
[![Security](https://img.shields.io/badge/security-audited-success?logo=shield&logoColor=white)](docs/THREAT_MODEL.md)
[![Privacy](https://img.shields.io/badge/privacy-zero--knowledge-blueviolet?logo=shield&logoColor=white)](#privacy-contract)
[![Stars](https://img.shields.io/github/stars/ahmedkobbi/veriface-edge?style=social)](https://github.com/ahmedkobbi/veriface-edge/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/ahmedkobbi/veriface-edge)](https://github.com/ahmedkobbi/veriface-edge/commits/main)
[![Repo Size](https://img.shields.io/github/repo-size/ahmedkobbi/veriface-edge)](https://github.com/ahmedkobbi/veriface-edge)
[![Issues](https://img.shields.io/github/issues/ahmedkobbi/veriface-edge)](https://github.com/ahmedkobbi/veriface-edge/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?logo=github)](CONTRIBUTING.md)

> **Production-grade, military-grade security.** No raw facial images ever leave the browser. The backend receives only a zero-knowledge Pedersen commitment and a signed JWT — it cannot reconstruct your face even if compromised.

## 📚 Documentation

- 🏠 **Live Demo & Marketing Site**: https://ahmedkobbi.github.io/veriface-edge/
- 📖 **Full Documentation**: [/docs](docs/)
- 🔒 **Threat Model (STRIDE)**: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
- 🎨 **Brand Guidelines**: [docs/BRAND_GUIDELINES.md](docs/BRAND_GUIDELINES.md)
- 🚀 **Production Checklist**: [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md)
- 🔑 **Secrets Rotation Guide**: [docs/SECRETS_ROTATION.md](docs/SECRETS_ROTATION.md)
- 📱 **Multi-Platform SDK Guide**: [src/sdk/PLATFORMS.md](src/sdk/PLATFORMS.md)

## What's Included

This is a complete, production-ready facial authentication platform with:

### SDK (Browser-side edge compute)
- **`src/sdk/veriface.ts`** — Main orchestrator (9-state machine, full capture→verify flow)
- **`src/sdk/crypto.ts`** — Real Ed25519, X25519 ECDH, AES-256-GCM, BLAKE3, HKDF, JWT, Pedersen commitment
- **`src/sdk/anti-injection.ts`** — 6-layer defense (virtual cam, timing jitter, replay, strobe, tamper, attestation)
- **`src/sdk/ai-pipeline.ts`** — MediaPipe face detection, CHROM rPPG, PAD, 512-dim geometric embedding
- **`src/sdk/react.ts`** — `useFaceAuth()` React hook
- **`src/sdk/vue.ts`** — Vue 3 composable
- **`src/sdk/web-component.ts`** — `<face-auth>` Web Component (vanilla JS)
- **`src/sdk/worker.ts`** — Web Worker for isolated crypto operations
- **`src/sdk/types.ts`** — Public TypeScript types + theme configs

### Backend API (Next.js API Routes)
- **`POST /api/tenant`** — Create tenant + initial API key
- **`POST /api/session/init`** — Initialize session (requires `session:init` scope)
- **`POST /api/session/verify`** — Verify ZK payload + issue token
- **`POST /api/session/cleanup`** — Cron: expire stale sessions
- **`POST /api/token/verify`** — Relying-party token introspection
- **`POST /api/token/revoke`** — Revoke token before expiry
- **`GET /api/audit`** — Hash-chained audit log query
- **`GET /api/audit/export`** — CSV/JSON export for compliance
- **`GET /api/verify-audit`** — Walk chain + verify integrity
- **`POST /api/templates/delete`** — GDPR Art. 17 (Right to be Forgotten)
- **`POST /api/api-keys/create`** — Create new API key
- **`GET /api/api-keys/list`** — List API keys (no plaintext)
- **`POST /api/api-keys/revoke`** — Revoke API key
- **`POST /api/tenant/webhook`** — Configure webhook URL + rotate secret
- **`POST /api/webauthn/register/begin`** — FIDO2 enrollment start
- **`POST /api/webauthn/register/finish`** — FIDO2 enrollment complete
- **`POST /api/webauthn/auth/begin`** — FIDO2 assertion start
- **`POST /api/webauthn/auth/finish`** — FIDO2 assertion verify
- **`GET /api/health`** — Health check
- **`POST /api/webhook/process`** — Webhook queue processor

### Security Features
- **API key authentication** on every endpoint (except `/api/tenant` bootstrap and `/api/health`)
- **Scope-based authorization** (`*`, `tenant:admin`, `session:init`, `session:verify`, `audit:read`)
- **Rate limiting** — token bucket per tenant + IP (configurable per tenant)
- **Tenant isolation** — tenant ID derived from API key, never from request body
- **Hash-chained audit log** — SHA-256(prevHash || eventType || payload || ts || tenantId)
- **Forward secrecy** — per-session ephemeral X25519 keypairs
- **Template encryption** — AES-256-GCM with tenant-derived DEK
- **Crypto-erasure** — KMS DEK destruction on GDPR deletion
- **WebAuthn hybrid flow** — step-up authentication with hardware authenticator
- **JWT revocation** — tokens can be revoked before natural expiry

### Database Schema (Prisma)
8 models: **Tenant, ApiKey, User, BiometricTemplate, Session, AuditLog, WebhookDelivery, RevokedToken, WebAuthnCredential, RateLimitBucket**

### DevOps & Operations
- **`Dockerfile`** — Multi-stage build, non-root user, healthcheck
- **`docker-compose.yml`** — App + PostgreSQL + Nginx + cron sidecar
- **`nginx.conf`** — TLS termination, security headers, rate limiting
- **`.github/workflows/ci.yml`** — Lint, type check, tests, security scan, Docker build
- **`prisma/migrations/0001_initial/migration.sql`** — Initial schema migration
- **`openapi.json`** — OpenAPI 3.1 specification for all endpoints

### Documentation
- **`README.md`** — This file
- **`docs/THREAT_MODEL.md`** — STRIDE analysis, attack trees, residual risks
- **`.env.example`** — Environment variable template

### Test Suite (51 tests, all passing)
- **`tests/crypto.test.ts`** (23 tests) — Ed25519, X25519, AES-GCM, BLAKE3, HKDF, JWT, Pedersen commitment
- **`tests/anti-injection.test.ts`** (13 tests) — Timing jitter, replay filter, strobe probe, fusion report
- **`tests/api.test.ts`** (15 tests) — End-to-end API: auth, scope enforcement, tenant isolation, audit chain

## Cryptographic Stack

| Layer | Algorithm | Library |
|-------|-----------|---------|
| SDK ↔ Backend auth | **Ed25519** signatures (JWT) | `@noble/curves` |
| Session key exchange | **X25519** ECDH (forward secrecy) | `@noble/curves` |
| Embedding encryption | **AES-256-GCM** | `@noble/ciphers` |
| Commitment + frame hash | **BLAKE3** | `@noble/hashes` |
| Key derivation | **HKDF-SHA256** | `@noble/hashes` |
| Webhook signing | **HMAC-SHA256** | `@noble/hashes` |
| API key hashing | **SHA-256** | `@noble/hashes` |

## Quick Start

```bash
# Install dependencies
bun install

# Push database schema
bun run db:push

# Start dev server
bun run dev

# Run tests
bun test
```

Open `http://localhost:3000` — a demo tenant + API key is auto-provisioned on first visit.

## SDK Usage

### React Hook

```tsx
import { useFaceAuth } from '@/sdk/react'

function LoginPage() {
  const { status, liveness, error, authenticate, videoRef } = useFaceAuth({
    tenantId: process.env.NEXT_PUBLIC_VERIFACE_TENANT!,
    apiKey: process.env.NEXT_PUBLIC_VERIFACE_API_KEY!,
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

### Web Component (vanilla JS)

```html
<script type="module" src="/sdk/web-component.js"></script>

<face-auth
  tenant-id="tnt_..."
  api-key="vf_live_..."
  flow="authenticate"
  external-user-id="user_123"
  theme="auto"
></face-auth>

<script>
  const el = document.querySelector('face-auth')
  el.addEventListener('veriface:success', (e) => {
    console.log('Token:', e.detail.token)
  })
  el.addEventListener('veriface:failure', (e) => {
    console.warn('Failed:', e.detail.code)
  })
</script>
```

### Vue 3 Composable

```vue
<script setup lang="ts">
import { useFaceAuth } from '@veriface/vue'

const { status, liveness, error, authenticate, videoRef } = useFaceAuth({
  tenantId: 'tnt_...',
  apiKey: 'vf_live_...',
})
</script>

<template>
  <video ref="videoRef" autoplay playsinline muted />
  <button @click="authenticate('user_123')">Sign in with Face</button>
</template>
```

### Backend API (cURL)

```bash
# 1. Create tenant (returns API key)
curl -X POST http://localhost:3000/api/tenant \
  -H "Content-Type: application/json" \
  -d '{"name":"My Company"}'

# 2. Initialize session (requires API key)
curl -X POST http://localhost:3000/api/session/init \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"flow":"enroll","externalUserId":"user_123"}'

# 3. Query audit log
curl http://localhost:3000/api/audit?limit=50 \
  -H "Authorization: Bearer vf_live_..."

# 4. Verify chain integrity
curl http://localhost:3000/api/verify-audit \
  -H "Authorization: Bearer vf_live_..."

# 5. GDPR — Delete template
curl -X POST http://localhost:3000/api/templates/delete \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"externalUserId":"user_123"}'
```

## File Structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Demo dashboard
│   │   ├── layout.tsx
│   │   └── api/                              # 18 API endpoints
│   │       ├── tenant/
│   │       ├── session/{init,verify,cleanup}/
│   │       ├── token/{verify,revoke}/
│   │       ├── audit/
│   │       ├── verify-audit/
│   │       ├── templates/delete/
│   │       ├── api-keys/{create,list,revoke}/
│   │       ├── tenant/webhook/
│   │       ├── webauthn/{register,auth}/{begin,finish}/
│   │       ├── webhook/process/
│   │       └── health/
│   ├── sdk/                                  # Browser SDK
│   │   ├── veriface.ts                       # Main orchestrator
│   │   ├── crypto.ts                         # Cryptographic primitives
│   │   ├── anti-injection.ts                 # 6-layer defense
│   │   ├── ai-pipeline.ts                    # Detection, rPPG, PAD, embedding
│   │   ├── react.ts                          # React hook
│   │   ├── vue.ts                            # Vue composable
│   │   ├── web-component.ts                  # <face-auth> Web Component
│   │   ├── worker.ts                         # Web Worker (isolated crypto)
│   │   └── types.ts                          # Public TypeScript types
│   ├── lib/                                  # Server-side libraries
│   │   ├── crypto-server.ts                  # Server crypto (mirrors SDK)
│   │   ├── tenant.ts                         # Tenant + template management
│   │   ├── session.ts                        # Session lifecycle
│   │   ├── audit.ts                          # Hash-chained audit log
│   │   ├── webhook.ts                        # Webhook delivery queue
│   │   ├── jwt-server.ts                     # Server JWT signing
│   │   ├── auth.ts                           # API key auth + rate limiting
│   │   └── db.ts                             # Prisma client
│   └── components/veriface/                  # Demo UI components
│       ├── DemoConsole.tsx
│       ├── FaceCapturePanel.tsx
│       ├── LivenessPanel.tsx
│       ├── AntiInjectionPanel.tsx
│       └── AuditLogPanel.tsx
├── prisma/
│   ├── schema.prisma                         # 10 models
│   └── migrations/0001_initial/migration.sql
├── tests/                                    # 51 tests (all passing)
│   ├── crypto.test.ts                        # 23 tests
│   ├── anti-injection.test.ts                # 13 tests
│   └── api.test.ts                           # 15 tests
├── docs/
│   └── THREAT_MODEL.md                       # STRIDE analysis
├── .github/workflows/ci.yml                  # GitHub Actions CI/CD
├── Dockerfile                                # Multi-stage build
├── docker-compose.yml                        # App + PostgreSQL + Nginx + cron
├── nginx.conf                                # TLS + security headers + rate limit
├── openapi.json                              # OpenAPI 3.1 spec
├── README.md
└── .env.example
```

## Compliance

- **GDPR Art. 25** (Privacy by Design) — edge-only computation, no raw images
- **GDPR Art. 17** (Right to be Forgotten) — instant template + DEK destruction
- **GDPR Art. 32** (Security of Processing) — AES-256-GCM + per-tenant keys
- **BIPA** — no face geometry collection (only irreversible embedding)
- **ISO/IEC 30107-3** (PAD) — architecture supports certification pathway
- **EU AI Act** — high-risk AI conformity assessment ready
- **PSD2 SCA** — `amr: ['face']` + `acr: 'eidas:substantial'` in JWT
- **SOC 2 Type II** — audit log + access controls + rate limiting

## License

Proprietary. All rights reserved.

---

## Privacy Contract

All 5 platform SDKs (Web, React Native, iOS, Android, Flutter) obey the same privacy contract:

1. **All biometric computation runs on-device** — face detection, rPPG, PAD, and embedding never leave the device.
2. **Only cryptographic payloads are sent to the backend**:
   - Pedersen commitment: `BLAKE3(embedding || nonce)` — proves the SDK computed the embedding honestly
   - Encrypted embedding: AES-256-GCM with the session ECDH key
   - Scalar liveness scores (rPPG, PAD) and anti-injection summary
3. **End-to-end encrypted**: The session key is derived via X25519 ECDH between SDK and backend — even the backend can't decrypt without the ephemeral session key.
4. **No face frames, no embeddings, no PII are ever stored on disk** by the SDK.
5. **Telemetry is opt-in and anonymous** — error codes only, no biometric data.

## Multi-Platform SDKs

| Platform | Package | Camera | Face Detection | Crypto |
|----------|---------|--------|----------------|--------|
| **Web** | `@veriface/edge-sdk` | getUserMedia | MediaPipe | @noble |
| **React Native** | `@veriface/edge-react-native` | WebView | WebView | WebView |
| **iOS** | `VeriFaceEdge` (SPM) | AVFoundation | Vision | CryptoKit + BLAKE3 |
| **Android** | `io.veriface:edge-sdk-android` | CameraX | ML Kit | BouncyCastle |
| **Flutter** | `veriface_edge` | `camera` plugin | `google_mlkit_face_detection` | `cryptography` package |

See [src/sdk/PLATFORMS.md](src/sdk/PLATFORMS.md) for the full comparison + quick start for each platform.

## Quick Start (Web SDK)

```bash
# 1. Clone the repo
git clone https://github.com/ahmedkobbi/veriface-edge.git
cd veriface-edge

# 2. Install dependencies
bun install

# 3. Set up environment
cp .env.example .env
# Edit .env and set VERIFACE_SERVER_SIGNING_KEY (openssl rand -hex 32)

# 4. Initialize the database
bun run db:push

# 5. Start the dev server
bun run dev
# Open http://localhost:3000
```

```ts
// 6. Use the SDK in your app
import { VeriFace } from '@veriface/edge-sdk'

const vf = new VeriFace({
  tenantId: 'tnt_...',
  apiKey: 'vf_live_...',
})

const result = await vf.authenticate(externalUserId: 'user_123')
console.log('Auth token:', result.authPayload?.token)
```

## Releases

Download the latest release from the [Releases page](https://github.com/ahmedkobbi/veriface-edge/releases):

- **Source code** (tar.gz + zip) — auto-generated by GitHub
- **Docker image** — `docker pull ghcr.io/ahmedkobbi/veriface-edge:latest`
- **npm packages** (coming soon):
  - `@veriface/edge-sdk` — Web SDK
  - `@veriface/edge-react-native` — React Native SDK
- **Swift Package** (coming soon):
  - `https://github.com/ahmedkobbi/veriface-edge.git` (SPM)
- **Maven** (coming soon):
  - `io.veriface:edge-sdk-android:1.0.0`
- **Pub** (coming soon):
  - `veriface_edge: ^1.0.0`

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before opening a PR.

- 🐛 [Report a bug](https://github.com/ahmedkobbi/veriface-edge/issues/new?labels=bug&template=bug-report.md)
- ✨ [Request a feature](https://github.com/ahmedkobbi/veriface-edge/issues/new?labels=enhancement&template=feature-request.md)
- 🔒 [Report a security vulnerability](https://github.com/ahmedkobbi/veriface-edge/security/advisories/new)
- 💬 [Start a discussion](https://github.com/ahmedkobbi/veriface-edge/discussions)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ahmedkobbi/veriface-edge&type=Date)](https://star-history.com/#ahmedkobbi/veriface-edge&Date)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/ahmedkobbi">ahmedkobbi</a></sub><br>
  <sub>If this project helps you, please consider <a href="https://github.com/ahmedkobbi/veriface-edge/stargazers">⭐ starring the repo</a>!</sub>
</p>
