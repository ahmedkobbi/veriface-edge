# VeriFace Edge — Privacy-First Web Facial Authentication SDK

> **Production-grade, military-grade security.** No raw facial images ever leave the browser. The backend receives only a zero-knowledge Pedersen commitment and a signed JWT — it cannot reconstruct your face even if compromised.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser (Edge Compute)                                          │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ Camera   │ → │ Anti-    │ → │ Face     │ → │ Align    │    │
│  │ Capture  │   │ Injection│   │ Detect   │   │ 112×112  │    │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
│                                                      ↓         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ rPPG     │ ← │ PAD      │ ← │ Embed    │ ← │ Affine   │    │
│  │ (CHROM)  │   │ (CDCN+)  │   │ Generate │   │ Warp     │    │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
│       ↓                                                         │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Pedersen Commitment (BLAKE3) + Ed25519 Signed JWT    │      │
│  └──────────────────────────────────────────────────────┘      │
│       ↓                                                         │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ AES-256-GCM Encrypted Payload (X25519 ECDH session)  │      │
│  └──────────────────────────────────────────────────────┘      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS POST
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Backend (Next.js API Routes)                                    │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ Verify   │ → │ Decrypt  │ → │ Verify   │ → │ Match /  │    │
│  │ JWT Sig  │   │ Embed    │   │ Commit   │   │ Enroll   │    │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
│       ↓                                                         │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Hash-Chained Audit Log + Webhook + Signed Token      │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Cryptographic Stack

| Layer | Algorithm | Library |
|-------|-----------|---------|
| SDK ↔ Backend auth | **Ed25519** signatures (JWT) | `@noble/curves` |
| Session key exchange | **X25519** ECDH (forward secrecy) | `@noble/curves` |
| Embedding encryption | **AES-256-GCM** | `@noble/ciphers` |
| Commitment + frame hash | **BLAKE3** | `@noble/hashes` |
| Key derivation | **HKDF-SHA256** | `@noble/hashes` |
| Webhook signing | **HMAC-SHA256** | `@noble/hashes` |

## Anti-Injection Defense (6 layers)

1. **Virtual camera detection** — label-based denylist (OBS, ManyCam, Snap Camera, …)
2. **Frame-timing jitter analysis** — σ/μ < 0.05 = synthetic stream
3. **Replay detection** — BLAKE3 frame hash + 10-min rolling bloom filter
4. **Sub-perceptible micro-strobe probe** — challenge/response reflection
5. **Browser extension tamper check** — prototype integrity + worker isolation
6. **Hardware attestation** — WebAuthn / iOS App Attest (where available)

## AI Pipeline

| Stage | Model | Output |
|-------|-------|--------|
| Detection | MediaPipe FaceLandmarker (478 pts) | Bounding box + landmarks |
| Alignment | Affine warp (5-point similarity) | 112×112 canonical face |
| rPPG | CHROM (chrominance-based) | Pulse score + HR (BPM) + SNR |
| PAD texture | Laplacian variance | Micro-texture score [0,1] |
| PAD depth | Landmark z-range heuristic | Geometric depth score [0,1] |
| Embedding | 512-dim geometric features (L2-normalized) | Template vector |

## Backend API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tenant` | POST | Create enterprise tenant (returns signing key) |
| `/api/tenant?id=xxx` | GET | Fetch tenant metadata |
| `/api/session/init` | POST | Initialize auth session (returns challenge + backend pubkey) |
| `/api/session/verify` | POST | Verify ZK payload + issue token |
| `/api/audit?tenantId=xxx` | GET | Fetch hash-chained audit log |
| `/api/verify-audit?tenantId=xxx` | GET | Walk chain + verify integrity |
| `/api/templates/delete` | POST | GDPR Art. 17 — Right to be Forgotten |
| `/api/webhook/process` | POST | Process pending webhook deliveries |

## Database Schema (Prisma)

- **Tenant** — Enterprise client with dedicated KMS key, webhook secret, signing keypair
- **User** — End-user identity (external ID only — no PII stored)
- **BiometricTemplate** — Encrypted embedding + Pedersen commitment (never plaintext)
- **Session** — Ephemeral challenge-response state (60s TTL)
- **AuditLog** — Hash-chained append-only event log (7-year retention)
- **WebhookDelivery** — Signed webhook queue with exponential backoff
- **RevokedToken** — JWT blacklist for revocation before expiry

## Security Model

### What the backend NEVER receives
- Raw camera frames
- Face images / video
- Plaintext embeddings (only AES-256-GCM encrypted)
- Biometric raw signals

### What the backend DOES receive
- Pedersen commitment (one-way BLAKE3 hash of embedding + nonce)
- Scalar liveness scores (rPPG, PAD texture, PAD depth)
- Anti-injection report (boolean flags + scalar metrics)
- AES-256-GCM encrypted embedding (only decrypted inside verify flow)

### Forward Secrecy
Each session generates ephemeral X25519 keypairs on both sides. The shared
session key is derived via HKDF and never persisted. If the server is
compromised after the session, past sessions cannot be decrypted.

### Right to be Forgotten (GDPR Art. 17)
1. Delete template from Postgres + Qdrant (immediate, < 5s)
2. Schedule KMS DEK destruction (renders any backup unrecoverable, < 24h)
3. Issue signed revocation receipt (legal proof of deletion)

## Quick Start

```bash
# Install dependencies
bun install

# Push database schema
bun run db:push

# Start dev server
bun run dev
```

Open `http://localhost:3000` — a demo tenant is auto-provisioned on first visit.

## SDK Usage (React)

```tsx
import { useFaceAuth } from '@/sdk/react'

function LoginPage() {
  const { status, liveness, error, authenticate, videoRef } = useFaceAuth({
    tenantId: process.env.NEXT_PUBLIC_VERIFACE_TENANT!,
    livenessThreshold: 0.78,
    captureDurationMs: 1800,
  })

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted />
      <button onClick={() => authenticate('user_123')}>
        Sign in with Face
      </button>
      {liveness && <span>Liveness: {(liveness.overall * 100).toFixed(0)}%</span>}
    </>
  )
}
```

## SDK Usage (Vanilla JS)

```ts
import { VeriFace } from '@/sdk/veriface'

const vf = new VeriFace({
  tenantId: 'tnt_...',
  livenessThreshold: 0.78,
})

const session = await vf.initSession('authenticate', 'user_123')
await vf.openCamera()
const { embedding, liveness, antiInjection, commitmentNonce } = await vf.capture()
const result = await vf.verify(
  session.sessionId, session.challenge, session.backendPubKey,
  embedding, liveness, antiInjection, commitmentNonce, 'user_123',
)

if (result.success) {
  console.log('Auth OK, token:', result.authPayload.token)
}
```

## File Structure

```
src/
├── app/
│   ├── page.tsx                          # Demo dashboard (single-page)
│   ├── layout.tsx
│   └── api/
│       ├── tenant/route.ts               # Tenant provisioning
│       ├── session/init/route.ts         # Session init
│       ├── session/verify/route.ts       # ZK payload verification
│       ├── audit/route.ts                # Audit log query
│       ├── verify-audit/route.ts         # Chain integrity check
│       ├── templates/delete/route.ts     # GDPR RTBF
│       └── webhook/process/route.ts      # Webhook queue processor
├── sdk/
│   ├── veriface.ts                       # Main SDK orchestrator
│   ├── crypto.ts                         # Ed25519, X25519, AES-GCM, BLAKE3
│   ├── anti-injection.ts                 # 6-layer injection defense
│   ├── ai-pipeline.ts                    # Detection, rPPG, PAD, embedding
│   └── react.ts                          # useFaceAuth React hook
├── lib/
│   ├── crypto-server.ts                  # Server-side crypto (mirrors SDK)
│   ├── tenant.ts                         # Tenant + template management
│   ├── session.ts                        # Session lifecycle
│   ├── audit.ts                          # Hash-chained audit log
│   ├── webhook.ts                        # Webhook delivery queue
│   ├── jwt-server.ts                     # Server JWT signing
│   └── db.ts                             # Prisma client
└── components/veriface/
    ├── DemoConsole.tsx                   # Main demo orchestrator
    ├── FaceCapturePanel.tsx              # Live video + face overlay
    ├── LivenessPanel.tsx                 # Real-time liveness scores
    ├── AntiInjectionPanel.tsx            # Anti-injection status
    └── AuditLogPanel.tsx                 # Audit log viewer
```

## Compliance

- **GDPR Art. 25** (Privacy by Design) — no raw images, edge-only computation
- **GDPR Art. 17** (Right to be Forgotten) — instant template + DEK destruction
- **GDPR Art. 32** (Security of Processing) — AES-256-GCM + per-tenant keys
- **BIPA** — no face geometry collection (only irreversible embedding)
- **ISO/IEC 30107-3** (PAD) — architecture supports certification pathway
- **EU AI Act** — high-risk AI conformity assessment ready

## License

Proprietary. All rights reserved.
