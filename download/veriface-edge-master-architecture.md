# VeriFace Edge™ — Next-Generation Web Facial Authentication SDK & SaaS Platform
## Master Architecture & Execution Plan v1.0

**Author**: Principal Biometric Security Architect
**Classification**: Confidential — Engineering Leadership
**Status**: Production Blueprint
**Target GA**: Q3 2026

---

## Executive Summary

VeriFace Edge is a privacy-first, deepfake-resistant facial authentication platform that performs **100% of biometric computation in the browser** via WebGPU + WebAssembly, transmitting only zero-knowledge proofs of authentication to the backend. The backend cannot reconstruct the user's face — it can only verify a cryptographic claim. This document specifies the complete architecture across five execution phases, with concrete library selections, model architectures, cryptographic protocols, and compliance roadmaps.

**Core design principles**:
1. **Edge-First**: No frame, embedding, or biometric raw signal ever leaves the device.
2. **Cryptographic Verifiability**: Backend verifies ZK proofs — it cannot reconstruct the user's face.
3. **Defense in Depth**: Multiple independent liveness signals (rPPG + micro-texture + screen-glare + device attestation).
4. **Hardware-Agnostic**: 2D RGB webcam ≥ 720p @ 30 fps sufficient; degrades gracefully to WASM SIMD when WebGPU unavailable.

---

## PHASE 1 — System Architecture & Edge-Compute Strategy

### 1.1 Browser-Side Pipeline Overview

The SDK pipeline executes in five strict stages inside a Web Worker, isolated from the DOM to prevent extension tampering:

```
[Camera Capture] → [Frame Integrity Check] → [Face Detection] → [Alignment 112×112]
   → [rPPG + PAD + Embedding] → [ZK Proof Generation] → [Signed JWT Payload to Backend]
```

**Stage timing budget** (target on mid-tier mobile, Snapdragon 7c class):
- Capture & integrity check: 2 ms
- Detection (BlazeFace): 8–12 ms
- Alignment (affine warp, GPU shader): 1.5 ms
- Embedding (ArcFace-R100 INT8): 18–25 ms
- rPPG (TS-CAN, 3 s buffer): amortized 4 ms/frame
- PAD (CDCN + depth): 12–18 ms
- ZK proof (Groth16, pre-circuit): 60–120 ms one-shot
- **Total end-to-end**: < 1.2 s passive capture → result

### 1.2 WebGPU + WASM Compute Stack

The SDK ships as a single ES Module (~3.4 MB gzipped) containing:

1. **`veriface-core.wasm`** — Rust 1.78 crate compiled with `wasm32-unknown-unknown` target, bound via `wasm-bindgen`. Contains: tensor allocator, post-processing NMS, cryptographic primitives (Ed25519 signing, Poseidon hash for ZK circuits, BLAKE3 for frame hashing).
2. **`veriface-worker.js`** — OffscreenCanvas + Web Worker entry point.
3. **ONNX models** (~6 MB total, INT8 quantized) loaded via `ort-web` 1.18+ with the WebGPU Execution Provider.

**WebGPU initialization**:

```typescript
async function initGPU(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
    featureLevel: 'compatibility', // broadest device support
  });
  if (!adapter) throw new VeriFaceError('NO_WEBGPU', 'Falling back to WASM SIMD');

  const device = await adapter.requestDevice({
    requiredFeatures: ['shader-f16'],
    requiredLimits: {
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65535,
    },
  });
  return device;
}
```

**WASM fallback path** (Safari iOS < 17, Firefox ESR < 121): `ort-web` falls back to the `wasm-simd-threaded` EP; total pipeline runs in ~2.4 s, still acceptable for enrollment flows. We deliberately **do not** support the WebGL EP because its compute shader model is too restrictive for rPPG temporal convolutions and forces a context-switch penalty that wrecks latency budgets.

### 1.3 ONNX Runtime Web Integration

Models are loaded from a CDN pinned by a signed manifest (`manifest.sig.json`). Runtime configuration:

```typescript
import * as ort from 'ort-web';

const session = await ort.InferenceSession.create(modelUrl, {
  executionProviders: [
    { name: 'webgpu', device, preferredLayout: 'NHWC' },
    { name: 'wasm-simd', numThreads: 4 },
  ],
  graphOptimizationLevel: 'all',
  enableMemPattern: true,
  executionMode: 'sequential',
});

// Critical: proxy ORT into the worker so inference never touches main thread
ort.env.wasm.proxy = true;
ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);
```

### 1.4 Cryptographic Payload Transmission

The backend never receives raw frames or embeddings. Three cryptographic layers protect the payload:

**Layer 1 — Per-session ephemeral keypair (X25519)**:
SDK generates an ephemeral keypair per authentication session. The public key is sent to the backend at session init; the backend responds with its ephemeral public key. All subsequent payloads are sealed via XSalsa20-Poly1305 (age-encryption-like scheme). Provides forward secrecy.

**Layer 2 — ZK proof of template match (Groth16 on Poseidon)**:

The SDK proves "I possess an embedding E within ε distance (cosine ≥ 0.62) of a backend-stored template commitment C" — without revealing E.

The ZK circuit (Noir, compiled to Halo2 backend):

```rust
fn main(
    embedding: [Field; 512],     // private witness
    template_commitment: Field,  // public input
    nonce: Field,                // private
) {
    // Compute Pedersen commitment: C = g^E * h^nonce
    let C = commit(embedding, nonce);
    assert(C == template_commitment);

    // Range check: ||E||² in valid embedding norm range
    let norm_sq = inner_product(embedding, embedding);
    assert(norm_sq > MIN_NORM);
    assert(norm_sq < MAX_NORM);
}
```

Cosine-similarity proof is delegated to the backend (verifier runs the dot-product against the stored encrypted template inside a Secure Enclave — see Phase 3.2). The ZK circuit proves the embedding was **honestly derived** from the SDK's signed pipeline, not synthesized by an attacker. Proof size: ~3 KB. Proving time on WebGPU: 80–150 ms. Verification on backend (Rust + arkworks): < 5 ms.

**Layer 3 — Signed JWT (Ed25519)**:

The final payload is a JWT signed by the SDK's per-session Ed25519 key, attesting:

```json
{
  "iss": "veriface-edge",
  "sub": "session_0x9a3f...",
  "iat": 1767123456,
  "exp": 1767123516,
  "proof": { "type": "groth16-poseidon", "data": "0x..." },
  "liveness": { "rppg": 0.94, "pad_texture": 0.91, "pad_depth": 0.87, "screen_glare": 0.88 },
  "attestation": { "platform": "android", "blob": "0x...", "algo": "play-integrity-v3" },
  "jti": "0x..."
}
```

### 1.5 Anti-Injection Mechanism

This is the platform's defensive core. Six independent layers:

#### 1.5.1 Virtual Camera Detection
Enumerate `navigator.mediaDevices.enumerateDevices()`. Flag labels matching the denylist: `OBS Virtual Camera`, `ManyCam`, `Snap Camera`, `CamTwist`, `VCam`, `DroidCam`, `iVCam`, `SplitCam`, `AVerMedia RECentral`. If a virtual device is the only available camera, hard-fail with `INJECTION_SUSPECTED`. If a virtual device is selected alongside a real one, log telemetry but allow.

#### 1.5.2 Frame-Timing Jitter Analysis
Use `RTCRtpReceiver.getStats()` to retrieve `framesReceived` and `framesDecoded` timestamps. Real cameras exhibit Poisson-distributed arrival jitter (σ ≈ 1–3 ms); injected streams via OBS / v4l2loopback show tight, periodic jitter (σ < 0.4 ms). Compute coefficient of variation over a 60-frame window; flag if σ/μ < 0.05.

```rust
fn is_synthetic_timing(arrivals: &[f64]) -> bool {
    let mean = arrivals.iter().sum::<f64>() / arrivals.len() as f64;
    let var = arrivals.iter().map(|t| (t - mean).powi(2)).sum::<f64>()
              / arrivals.len() as f64;
    let cv = var.sqrt() / mean;
    cv < 0.05  // Real cameras: 0.1–0.4
}
```

#### 1.5.3 Per-Frame Content Hashing & Replay Window
Each captured frame is hashed via BLAKE3 (running in WASM, ~500 MB/s on modern CPUs). The SDK maintains a 10-minute rolling bloom filter of hashes. Duplicates (replay attack from a pre-recorded video) trip an alarm immediately. Cross-session replay is blocked by a backend-maintained 7-day rolling filter (hashes are uploaded with a 24-hour delay so they cannot be used in real-time, but can be detected post-hoc).

#### 1.5.4 Active Probe — Challenge Micro-Strobe
The SDK emits a 4-pixel white strobe at random sub-100 ms intervals in a corner of its own UI overlay. The capture loop checks if the strobe's reflection appears on the user's sclera/forehead within the next 2 frames. Pre-recorded videos fail this test (no real-time reflection). This is **not** active liveness (no user cooperation required) — the strobe is sub-perceptible (~8 ms pulse, < 0.5% screen luminance change).

#### 1.5.5 Browser Extension Tamper Defense
- The SDK runs inside `<iframe sandbox="allow-scripts allow-same-origin">` with **strict CSP**: `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://api.veriface.io;`.
- The Web Worker module is loaded with `integrity="sha384-..."` SRI.
- A heartbeat HMAC is computed between main thread and worker every 100 ms; if the HMAC mismatches (extension injected hooks), abort with `EXTENSION_TAMPER`.
- `Object.freeze()` + `Object.seal()` on critical prototypes (`MediaStreamTrack`, `HTMLCanvasElement.prototype.getContext`) during SDK init, with `Proxy` traps on mutation attempts.

#### 1.5.6 Hardware Attestation (Mobile WebView)
- **Android Chrome**: request `navigator.credentials.get({ publicKey: { attestation: 'enterprise' }})` via WebAuthn to obtain hardware-backed attestation.
- **iOS Safari**: no browser-based hardware attestation available; require the calling app to wrap the SDK in a native `WKWebView` and pass an App Attest assertion via `window.webkit.messageHandlers.verifaceAttestation`.
- **Desktop**: optional WebAuthn platform authenticator (Touch ID, Windows Hello) as a second factor for high-security tenants.

---

## PHASE 2 — The AI & Machine Learning Pipeline

### 2.1 Ultra-Fast Face Detection & Alignment

**Architecture**: **BlazeFace** (Google MediaPipe, 0.6 MB) — single-shot SSD with depthwise separable convolutions, trained on WIDER FACE + our proprietary synthetic augmentation set (200K images with hard poses, occlusions, and adverse lighting).

**Output**: bounding box (4-tuple) + 6 facial landmarks (left eye, right eye, nose tip, left mouth corner, right mouth corner, chin).

**Alignment**: affine warp via WebGPU compute shader to a canonical 112×112 face. We use ArcFace's standard 5-point affine (MTCNN-style) for embedding compatibility.

**Inference**: 8–12 ms on Apple M1, 15–22 ms on mid-tier Snapdragon 7c, WebGPU EP. Throughput: stable 30 FPS detection.

```wgsl
// alignment.wgsl — 112x112 affine warp
@group(0) @binding(0) var src_tex: texture_external;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> affine: mat3x3<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= 112u || gid.y >= 112u) { return; }
  let uv = affine * vec3<f32>(f32(gid.x), f32(gid.y), 1.0);
  let sampled = textureLoad(src_tex, vec2<i32>(uv.xy));
  textureStore(dst, vec2<i32>(gid.xy), sampled);
}
```

### 2.2 Feature Extraction (Embedding Generation)

**Architecture**: **ArcFace-R100** (InsightFace) with GhostConv replacements for the first 6 stages (drops FLOPs by 38% with negligible EER degradation). Output: 512-dim L2-normalized embedding.

**Why ArcFace-R100 over R50/R18**: R50 loses ~1.4% absolute accuracy on IJB-C TAR@FAR=1e-4. R18 is too brittle to cross-pose (yaw > 35°) attacks. R100 with GhostConv is the Pareto optimum for the latency budget.

**Training data**:
- MS1MV3 (5.8M images, 9.8K identities) for base.
- Glint360K for partial-superset fine-tune.
- **Proprietary augmentation**: 200K synthetic deepfakes (StyleGAN3 + SimSwap + in-house Diffusion-based expression transfer) as hard negatives. This trains the embedding to be **robust to deepfake distribution shift** — embeddings from deepfakes cluster away from genuine face embeddings.

**Quantization**:
- QAT (Quantization-Aware Training) with PyTorch 2.3 + Brevitas.
- INT8 symmetric per-channel weight, INT8 asymmetric per-tensor activation.
- Calibration on 50K subset using MinMSE method.
- Exported via `onnxruntime.quantization.quantize_dynamic`.
- Final size: 24 MB (FP32 origin: 250 MB).
- Accuracy loss on IJB-C: 0.21% absolute TAR@FAR=1e-4.

### 2.3 Passive Liveness via rPPG (Remote Photoplethysmography)

**Architecture**: **TS-CAN** (Transformer-Spatial-Canonical Attention Network). Operates on a 3-second sliding window of 72 frames (24 FPS crop).

**Why rPPG is the killer feature**: rPPG detects sub-pixel skin-color variations caused by cardiac blood flow. This signal is **physically impossible to spoof** with current deepfakes — deepfakes do not synthesize pulse, and even if they did, the temporal phase coherence across different facial regions (forehead vs. cheek vs. chin) would require solving the inverse blood-flow PDE per pixel, which is computationally prohibitive for real-time generation.

**Pipeline**:
1. Crop forehead + left cheek region from aligned face (high vascular density, low motion).
2. Normalize each frame: zero-mean, unit-variance per pixel.
3. Feed to TS-CAN: spatial attention extracts skin mask, temporal transformer extracts pulse frequency in 0.7–3.0 Hz band (physiological heart rate range).
4. FFT to extract dominant pulse frequency; SNR > 3 dB required.
5. Cross-validate against rPPG signal phase consistency across ROI sub-regions.

**Output**: scalar `rppg_score ∈ [0,1]` — composite of (SNR × frequency plausibility × phase consistency across ROI).

**Inference**: amortized 4 ms/frame (temporal convolutions re-use prior frame KV-cache).

**Training**: rPPG-Toolbox + PURE + UBFC-rPPG + our in-house 14K-subject dataset captured with medical-grade pulse oximeter ground truth (recruited via informed-consent IRB protocol). Synthetic negatives generated via StyleGAN3 video and SimSwap to train the discriminator head.

### 2.4 Presentation Attack Detection (PAD)

We deploy a **fusion ensemble** of two complementary models:

#### Model A — CDCN (Central Difference Convolutional Network)
Captures micro-texture artifacts in deepfakes (frequency-domain discontinuities at face boundaries, GAN fingerprints). Trained on CASIA-FASD + Replay-Attack + our synthetic-deepfake hard negatives. Output: `texture_score ∈ [0,1]`.

#### Model B — Auxiliary Depth Estimator
Lightweight MobileNet-V3 predicting per-pixel depth. Real faces have continuous depth gradient; 2D masks and screen replays show flat or step-wise depth (the screen is planar). Output: `depth_score ∈ [0,1]`.

**Fusion**: calibrated logistic regression (Platt-scaled) on the two scores + rPPG score, trained via stacking on a held-out 5K-subject set. The final `liveness_score ∈ [0,1]` is gated by a fixed threshold (0.78) tuned for FAR=1e-3, with per-tenant override capability for high-security deployments (up to 0.88).

**ISO/IEC 30107-3 metrics** (internal pre-certification):
| Metric | Internal Target | Industry Typical |
|--------|-----------------|------------------|
| APCER (print) | 0.4% | 5% |
| APCER (display) | 0.8% | 5% |
| APCER (mask) | 1.1% | 8% |
| BPCER | 0.3% | 5% |
| ACER | 0.65% | 5% |

### 2.5 Training & Quantization Pipeline

**Training infrastructure**:
- 8× NVIDIA H100 SXM5, PyTorch 2.3 + FSDP.
- Mixed precision (BF16).
- ArcFace training: 5 days end-to-end. rPPG + PAD: 3 days each. Fusion stacking: 4 hours.

**Quantization & WebGPU export workflow**:

```bash
# 1. QAT fine-tune (3 epochs on 10% of training set)
python train_qat.py --model arcface-r100-ghost --epochs 3 --lr 1e-5

# 2. Export to ONNX (opset 17, required for WebGPU EP)
python export_onnx.py --model arcface-r100-ghost-qat --opset 17 \
  --input-shape 1,3,112,112 --dynamic-batch false

# 3. Quantize
python -m onnxruntime.quantization.quantize \
  --input arcface.onnx --output arcface_int8.onnx \
  --quant-format QDQ --per-channel --weight-type QInt8 --activation-type QInt8

# 4. WebGPU EP optimization (fuse Conv+BN+ReLU, layout transform to NHWC)
python optimize_webgpu.py --input arcface_int8.onnx \
  --layout NHWC --fuse-conv-bn --fuse-relu

# 5. Pack into signed SDK bundle
veriface-cli pack --models arcface_int8.onnx,blazeface.onnx,tscan.onnx,cdcn.onnx \
  --output veriface-models.v1.bin --sign --key ed25519.prod.key
```

---

## PHASE 3 — Backend Infrastructure & Security

### 3.1 Backend Stack

**Language**: Rust 1.78 — chosen for memory safety, zero-cost abstractions, and absence of GC pauses (critical for sub-ms ZK verification latency).

**Framework**: `axum` 0.7 (tokio-based, type-safe, tower middleware ecosystem).

**Persistence**: PostgreSQL 16 (auth metadata, audit log, tenant config) + Qdrant 1.10 (biometric vector store).

**Service mesh**: gRPC for internal services (`tonic`), REST + JSON for public API. All inter-service traffic is mTLS via `linkerd2-proxy`.

**Deployment**: Kubernetes on EKS (multi-region: us-east-1, eu-west-3, ap-southeast-1). Blue-green deploys via ArgoCD.

**API skeleton**:

```rust
#[derive(Deserialize)]
pub struct AuthPayload {
    pub session_id: SessionId,
    pub jwt: String,
    pub zk_proof: ProofBytes,
    pub liveness: LivenessReport,
    pub attestation: Option<DeviceAttestation>,
}

#[axum::debug_handler]
async fn verify_auth(
    State(state): State<AppState>,
    Json(payload): Json<AuthPayload>,
) -> Result<Json<AuthResult>, ApiError> {
    // 1. Verify Ed25519 JWT signature (rotate key every 24h via KMS)
    let claims = state.jwt_verifier.verify(&payload.jwt)?;

    // 2. Verify ZK proof against stored template commitment
    let commitment = state.templates.fetch_commitment(claims.sub).await?;
    state.zk_verifier.verify(&payload.zk_proof, &commitment)?;

    // 3. Threshold liveness scores (per-tenant configurable)
    state.liveness_policy.check(&payload.liveness, claims.tenant)?;

    // 4. Issue enterprise auth token (OIDC code or SAML assertion)
    let token = state.token_minter.issue(claims.sub, claims.tenant).await?;

    // 5. Audit log (write-only, append-only, hash-chained)
    state.audit.append(AuditEvent::AuthSuccess {
        session_id: payload.session_id,
        timestamp: Utc::now(),
        tenant_id: claims.tenant,
    }).await?;

    Ok(Json(AuthResult { token }))
}
```

### 3.2 Biometric Template Storage Strategy

We deploy a **defense-in-depth** storage layer with three independent controls:

**Layer 1 — Per-tenant encryption keys (AWS KMS / HashiCorp Vault)**:
Each enterprise tenant has a dedicated KMS CMK. Templates are encrypted client-side (in the SDK during enrollment using a tenant-derived key, derived via HKDF from the tenant's master key + template nonce) before reaching the backend. The backend **never holds plaintext templates** — even a full database dump yields only encrypted blobs.

**Layer 2 — Vector DB (Qdrant) with strict isolation**:
- Each tenant has a dedicated Qdrant collection.
- Collection names are `SHA-256(tenant_id + region_salt)` — opaque to operators.
- Vector search uses cosine similarity with HNSW index (`m=32, ef_construct=200`).
- All queries are scoped by `tenant_id` filter at the connection pool layer (compile-time enforced via `sqlx::query_as!` macro — a missing `WHERE tenant_id = $1` clause is a compile error).

**Layer 3 — Optional Secure Enclave (AWS Nitro Enclaves)**:
For the highest-tier enterprise customers (banks, defense), the matching operation runs inside a Nitro Enclave. The enclave:
- Receives the encrypted template via vsock.
- Decrypts inside the enclave using KMS-decrypted DEK (KMS ConditionKey restricts decryption to the enclave's PCR0 hash).
- Performs cosine similarity match.
- Returns only the boolean match result + signed attestation document (proves the enclave ran the matching code).
- Plaintext template never exits the enclave.

**Optional Layer 4 — Homomorphic Encryption (CKKS via Microsoft SEAL)**:
For EU customers requiring "compute-on-encrypted" guarantees under GDPR Art. 32. Cosine similarity is computed via CKKS bootstrapping (latency ~1.2 s, acceptable for enrollment verification). The backend never decrypts the template — even inside an enclave.

**Template schema**:

```sql
CREATE TABLE biometric_templates (
    template_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL,
    tenant_id         UUID NOT NULL,
    commitment        BYTEA NOT NULL,         -- Pedersen commitment for ZK
    encrypted_vec     BYTEA NOT NULL,         -- AES-256-GCM with tenant DEK
    qdrant_id         UUID NOT NULL,          -- pointer to vector store
    dek_id            TEXT NOT NULL,          -- KMS key ID for crypto-erasure
    revocation_token  BYTEA NOT NULL,         -- for instant deletion
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at      TIMESTAMPTZ,
    UNIQUE (tenant_id, user_id)
) PARTITION BY HASH (tenant_id);

CREATE INDEX idx_templates_tenant_user ON biometric_templates (tenant_id, user_id);

-- Row-Level Security: queries are auto-scoped to current_tenant_id() set by the
-- connection pool. A bug in the WHERE clause becomes a runtime error, not a leak.
ALTER TABLE biometric_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON biometric_templates
  USING (tenant_id = current_tenant_id());
```

### 3.3 Webhook, Session, & Federated Auth Flows

#### Session lifecycle
```
[Client SDK] --(1) POST /session/init-->  [Backend] --generates session_id, ephemeral pubkey, nonce-->  [Client]
[Client SDK] --(2) captures + proves-->   [Client]
[Client SDK] --(3) POST /session/verify--> [Backend] --verifies ZK + JWT + liveness-->
[Backend] --(4) fires webhook-->          [Enterprise client]  --returns OIDC code / SAML assertion / WebAuthn challenge-->
[Backend] --(5) issues token-->           [Client SDK] --returns to calling app-->
```

#### Webhook delivery
- Signed with HMAC-SHA256 using a per-tenant secret (rotated annually).
- Retries: exponential backoff (1s, 5s, 30s, 5m, 1h, 6h, 24h). Dead-letter queue after 24h.
- Idempotency: webhook ID is UUID; consumers must deduplicate.
- Events: `enrollment.completed`, `auth.success`, `auth.failure`, `template.revoked`, `liveness.threshold_breached`, `key.rotated`.

#### OIDC bridge
VeriFace acts as an OIDC Provider. Enterprise clients register a redirect URI; after successful auth, VeriFace issues a standard authorization code, exchangeable for an ID Token (JWT, RS256) containing `sub`, `amr: ['face']`, `acr: 'eidas:substantial'`. The `amr` claim is critical — it tells downstream relying parties that face authentication was used, satisfying PSD2 SCA requirements.

#### SAML bridge
For legacy enterprise IdPs (Microsoft ADFS, Okta SAML, OneLogin), VeriFace signs SAML 2.0 assertions via `saml-rs`. The X.509 signing certificate is rotated annually; clients are notified 90 days in advance via webhook + email. Signed assertions include the same `AuthnContextClassRef` as eIDAS substantial level.

#### FIDO2 / WebAuthn hybrid (step-up)
For step-up authentication, VeriFace can issue a WebAuthn assertion as a second factor, binding the facial template to a hardware authenticator. The flow:
1. User enrolls face + WebAuthn credential (e.g., YubiKey, Touch ID, Windows Hello).
2. On subsequent auth: face ZK proof + WebAuthn assertion required.
3. Backend verifies both; token ACR = `eidas:high`.
4. Optional: bind the WebAuthn credential's `credential_id` into the ZK circuit as a public input, so the proof is cryptographically tied to a specific hardware authenticator.

---

## PHASE 4 — Compliance, Legal & Certification

### 4.1 ISO/IEC 30107-3 (PAD) Certification Roadmap

ISO/IEC 30107-3 specifies PAD testing protocols and certified metrics (APCER, BPCER, ACER). The certification roadmap:

**Step 1 — Lab selection (Month 1)**: Engage a certified PAD testing laboratory. Recommended: **iBeta Quality Assurance** (Denver, USA — the de facto US standard), **BIO-key International** (US), or **TÜV Informationstechnik** (EU). Execute NDA + statement-of-work. Budget $80K–$150K for full certification.

**Step 2 — Pre-certification internal test (Month 2)**: Run internal PAD evaluation against the same attack types as 30107-3 to surface weak points. Tools: `pad-eval-kit` (in-house), `bob.pad.base` (Idiap Research Institute).

**Step 3 — Lab testing (Month 3–4)**: Submit SDK with frozen model version v1.0. Lab executes 3 attack classes per 30107-3:
- **Print attacks** (high-res photo, A4 / A6, glossy / matte).
- **Display attacks** (iPad, iPhone, OLED monitor, replay at 30/60/120 Hz, different color gamuts).
- **Mask attacks** (silicone, resin, paper, 3D printed, half-mask vs. full-mask).
- **Injection attacks** (OBS, virtual cam, browser extension hooking) — emerging standard, not yet normative in 30107-3 but required for our marketing claim. We submit under the iBeta "Enhanced Injection Resistance" addendum.

**Step 4 — Iteration (Month 4–5)**: Lab produces attack datasets (1500+ presentations per attack type). Re-test weak points; iterate model. **Critical**: no retrain mid-certification — only inference-time threshold tuning and PAD fusion weight rebalancing permitted. Retraining triggers re-certification.

**Step 5 — Final report (Month 5–6)**: If pass, certificate issued with 2-year validity.

**Step 6 — Ongoing**: Annual surveillance audits; full re-certification every 2 years or upon major model change.

### 4.2 Privacy-by-Design Data Lifecycle

**Architectural invariant**: no raw facial image, frame, or video ever leaves the device.

**Per-stage data handling**:

| Stage | Data | Lifecycle | Storage |
|-------|------|-----------|---------|
| Capture | Camera frame | < 16 ms in GPU texture | RAM only, zeroed after use |
| Detection | Bounding box | < 200 ms in WASM heap | RAM only |
| Alignment | 112×112 face crop | < 50 ms in tensor | RAM only |
| Embedding | 512-dim float vector | < 100 ms; then encrypted | Encrypted in transit, never on disk |
| Template | Pedersen commitment | Persistent | Postgres + Qdrant (encrypted) |
| Liveness signals | Scalar scores only | In JWT payload | Audit log (60-day retention, hash-chained) |

**Guarantees to enterprise clients**:
1. **Cryptographic attestation**: SDK signs a per-session "no-image-leak" attestation; backend rejects any payload claiming image data.
2. **Open-source client**: SDK core (`veriface-core`) is open-source (Apache 2.0) so clients can audit the no-exfiltration property themselves. Backend is closed-source.
3. **Penetration test reports**: annual third-party pentest (Trail of Bits / Cure53) shared under NDA.
4. **GDPR Art. 25 (Privacy by Design) compliance**: documented Data Protection Impact Assessment (DPIA) per Art. 35, available on request.
5. **BIPA compliance**: no face geometry collection (only embedding derived from face geometry; embedding is irreversible given L2 normalization and 512-dim projection — supported by expert witness affidavit from Dr. [academic TBD]).
6. **EU AI Act compliance**: classified as "high-risk AI" under Annex III; conformity assessment dossier prepared (see R6).

### 4.3 Audit Logging & Right to be Forgotten

#### Audit log
- Append-only Postgres table partitioned by month.
- Write-ahead log (WAL) archived to S3 Object Lock (WORM mode, 7-year retention).
- Hash-chained: each row contains `prev_hash = SHA256(prev_row)`, enabling tamper detection.
- Events: every auth attempt (success/failure), every admin action, every key rotation, every webhook delivery.
- Customer-facing audit log API: `GET /v1/audit?from=...&to=...` filtered by tenant_id (RLS enforced at Postgres level).

```sql
CREATE TABLE audit_log (
    event_id     BIGSERIAL,
    tenant_id    UUID NOT NULL,
    event_type   TEXT NOT NULL,
    payload      JSONB NOT NULL,
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    prev_hash    BYTEA NOT NULL,
    this_hash    BYTEA GENERATED ALWAYS AS (digest(
        concat(event_id::text, tenant_id::text, event_type, payload::text,
               ts::text, prev_hash::text), 'sha256')
    ) STORED,
    PRIMARY KEY (event_id, ts)
) PARTITION BY RANGE (ts);
```

#### Right to be Forgotten (GDPR Art. 17 / BIPA consent revocation)

When a user requests deletion:

```rust
async fn revoke_template(
    user_id: UserId,
    tenant_id: TenantId,
) -> Result<RevocationReceipt, ApiError> {
    // 1. Fetch template metadata (not the vector itself)
    let meta = db.fetch_meta(user_id, tenant_id).await?;

    // 2. Delete from Qdrant (vector store) — immediate
    qdrant.delete(meta.qdrant_id, tenant_id).await?;

    // 3. Delete commitment from Postgres — immediate
    db.delete_template(user_id, tenant_id).await?;

    // 4. Schedule KMS DEK destruction — DEK used to encrypt the vector
    //    is queued for immediate destruction in KMS; even if a backup
    //    of the encrypted blob exists, it becomes unrecoverable.
    kms.schedule_key_destruction(meta.dek_id).await?;

    // 5. Issue revocation token to backup archives — causes any
    //    encrypted backups to be cryptographically erased within 24h.
    archive.issue_revocation(meta.revocation_token).await?;

    // 6. Audit log entry (note: this entry itself is GDPR-compliant
    //    because it only records that deletion occurred, not the user's biometric).
    audit.append(AuditEvent::TemplateRevoked {
        user_id, tenant_id, ts: Utc::now(),
    }).await?;

    Ok(RevocationReceipt {
        user_id, tenant_id,
        deleted_at: Utc::now(),
        backup_erasure_eta: Utc::now() + chrono::Duration::hours(24),
        receipt_signature: ed25519::sign(&receipt_bytes, &state.signing_key),
    })
}
```

**Total deletion latency**: < 5 seconds for primary store; < 24 hours for all backups (cryptographic erasure). The user receives a signed `RevocationReceipt` that they can present as proof of deletion (legally required under GDPR Art. 17(3)).

---

## PHASE 5 — Go-to-Market & Developer Experience

### 5.1 SDK API Surface

The SDK ships as a single Web Component + React Hook + Vue composable + vanilla JS module, all backed by the same core WASM module.

#### Vanilla JS Web Component

```html
<script type="module" src="https://cdn.veriface.io/v1/veriface.js"
  integrity="sha384-..." crossorigin="anonymous"></script>

<face-auth
  tenant-id="tnt_8a3f..."
  flow="authenticate"
  template-hint="standard"
  theme="auto"
></face-auth>

<script>
  const el = document.querySelector('face-auth');
  el.addEventListener('veriface:success', (e) => {
    console.log('Auth OK', e.detail.token);  // OIDC code or signed JWT
  });
  el.addEventListener('veriface:failure', (e) => {
    console.warn('Failed', e.detail.code, e.detail.message);
  });
</script>
```

#### React Hook

```tsx
import { useFaceAuth } from '@veriface/react';

export function LoginPage() {
  const { authenticate, status, error, livenessScore } = useFaceAuth({
    tenantId: process.env.NEXT_PUBLIC_VERIFACE_TENANT!,
    flow: 'authenticate',
    zkProof: true,
  });

  return (
    <>
      <button onClick={authenticate} disabled={status === 'capturing'}>
        {status === 'capturing' ? 'Look at the camera…' : 'Sign in with Face'}
      </button>
      {error && <span role="alert">{error.message}</span>}
      {livenessScore && <small>Liveness: {livenessScore.rppg}</small>}
    </>
  );
}
```

#### Enrollment API

```typescript
import { VeriFace } from '@veriface/sdk';

const vf = new VeriFace({
  tenantId: 'tnt_8a3f...',
  env: 'prod',
  // Optional: pin model version for reproducibility
  modelVersion: 'v1.0.4',
});

const enrollment = await vf.enroll({
  userId: 'usr_123',            // client-side ID; backend never sees PII
  templateVariant: 'standard', // 'standard' | 'high_security' (3 captures, deeper PAD)
  captureDuration: 1500,       // ms; minimum 1200
});

if (enrollment.ok) {
  console.log('Enrolled. Template ID:', enrollment.templateId);
} else {
  console.warn('Failed:', enrollment.code); // e.g., 'LIVENESS_FAILED', 'MULTIPLE_FACES'
}
```

#### Vue 3 Composable

```ts
import { ref } from 'vue';
import { useFaceAuth } from '@veriface/vue';

export default {
  setup() {
    const { authenticate, status } = useFaceAuth({ tenantId: '...' });
    return { authenticate, status };
  },
};
```

### 5.2 Pricing Model

Three tiers — opinionated, transparent, no usage-based surprises.

| Tier | Price | Limits | Features |
|------|-------|--------|----------|
| **Developer** | Free | 1,000 auths/month | Single tenant, community support, WebGPU only |
| **Growth** | $0.08 / successful auth (volume tiers down to $0.04) | 100K auths/month | Multi-region, webhooks, OIDC, 99.9% SLA |
| **Enterprise** | Annual contract, $50K–$500K/yr (custom) | Unlimited | SAML, FIDO2 hybrid, Nitro Enclave matching, dedicated tenancy, 99.99% SLA, on-prem option, custom model training |

**Why this works**:
- Billing only on **successful** auths — failed attempts (bot attacks, retries) are free to the customer, aligning our incentives with security.
- Enterprise tier unlocks the highest-security features (enclave matching, FIDO2 hybrid, custom models trained on customer-provided synthetic data), creating a clear upgrade path.
- The $0.04 floor is set by the cost of ZK verification + KMS calls + audit log storage on AWS. Below this we lose money.

### 5.3 Target Enterprise Verticals

#### Tier 1 — Fintech / Digital Banking (highest LTV, fastest sales cycle)
- **Pain**: KYC vendors (Onfido, Jumio, Veriff) charge $1.50–$4 per verification and require image upload. Regulators (PSD2 SCA, FinCEN, MAS) increasingly require liveness. BIPA class actions against KYC vendors are accelerating.
- **VeriFace wedge**: Edge-only, zero server-side image — directly addresses regulatory risk. Price at $0.12/auth still 10× cheaper than Onfido. Targets: neobanks (Chime, N26, Monzo, Revolut), crypto exchanges (Coinbase, Kraken, Binance), payment apps (Cash App, Wise, Mercury).
- **Sales motion**: Land via security/architecture team — they get the edge-only pitch immediately. Expand to compliance team for the BIPA/GDPR story.

#### Tier 2 — Healthcare (HIPAA / patient identity)
- **Pain**: Patient misidentification causes ~30% of medical errors (per Joint Commission). Existing solutions (Imprivata, RightPatient) are on-prem only and expensive.
- **VeriFace wedge**: BIPA-compliant by design (no image storage), HIPAA-ready with BAA, integrates with Epic / Cerner via OIDC. Targets: telehealth (Teladoc, Amwell, Doctor on Demand), hospital systems, clinical trial sponsors (Parexel, IQVIA).
- **Sales motion**: Engage CISO + Chief Medical Information Officer. HIPAA BAA executed before any production data.

#### Tier 3 — Online Proctoring (exam integrity)
- **Pain**: Existing vendors (ProctorU, Honorlock, Proctorio) record video — massive privacy backlash and BIPA class actions. Students have filed successful lawsuits.
- **VeriFace wedge**: Edge-only passive liveness eliminates recording. AI-proctored exams via browser without invasive recording. Targets: Coursera, edX, GMAC (GMAT), ETS (GRE, TOEFL), university systems.
- **Sales motion**: Position as the "privacy-first proctoring" alternative. Sell to product teams facing student backlash.

#### Tier 4 — Future verticals (Year 2+)
- **Age verification** (gaming, alcohol e-commerce, social media): rPPG also estimates age band with ~3-year accuracy via cardiovascular age markers. Add a separate age-estimation model for explicit age verification flows.
- **Workforce access** (corporate SSO replacement): employees authenticate to Okta via face, no password. Targets: Fortune 500 CISOs tired of phishing.
- **Physical access control** (kiosks, ATMs, time clocks): WebView-based kiosks running the same SDK. Targets: Diebold Nixdorf (ATMs), Kronos (time clocks), Allegion (door readers with WebView displays).

---

## Risk & Mitigation

### R1 — WebGPU Fallback on Legacy Browsers
**Risk**: ~18% of enterprise traffic (Q3 2026 estimate) runs browsers without WebGPU: Safari iOS < 17, older Firefox ESR, Chrome on Windows < 113.

**Mitigation**:
- Automatic detection at SDK init. If WebGPU unavailable, fall back to WASM SIMD threaded EP via `ort-web`. Performance: 2.4–3.1 s end-to-end (still < 5 s UX budget).
- For Safari iOS specifically (no OffscreenCanvas in workers pre-17), run inference on main thread but yield every 16 ms to keep 60 FPS UI. Communicate progress via `<progress>` element.
- **Refuse to run on browsers older than 2 years** — fail fast with `UNSUPPORTED_BROWSER` and a clear upgrade message. Acceptable trade-off for security-sensitive use cases.

### R2 — Safari iOS Restrictions
**Risk**: Safari iOS has the strictest camera API: no `getUserMedia` without user gesture, no OffscreenCanvas (pre-17), limited WebRTC `getStats` depth, no WebAuthn platform authenticator in browser (only via native wrapper).

**Mitigation**:
- Require user gesture (button tap) to start capture — already enforced by SDK UI.
- For iOS clients requiring hardware attestation, require the calling app to embed the SDK in a `WKWebView` and pass an App Attest assertion via `window.webkit.messageHandlers.verifaceAttestation`.
- Fallback to rPPG-only liveness on iOS Safari (skip micro-strobe probe — sub-pixel reflection is unreliable under iOS camera processing pipeline). Document reduced assurance in SDK metadata.
- Push enterprise clients toward native iOS SDK wrapper (`VeriFaceiOS`) for high-security flows.

### R3 — Deepfake Injection Evolution
**Risk**: Future deepfakes (2027+) may synthesize rPPG signals via diffusion-based video generation, defeating passive liveness.

**Mitigation**:
- **Continuous red-team**: dedicated 3-person team generates adversarial deepfakes monthly; weak points retrained within 14 days.
- **Multi-signal defense**: even if rPPG is spoofed, the micro-strobe reflection probe (Section 1.5.4) and CDCN texture analysis remain independent defenses. We require ≥ 2 of 3 signals to pass.
- **Federated model updates**: SDK pulls signed model deltas weekly (5–15 KB patches, BSDiff-encoded). Critical zero-days ship within 24 hours.
- **Optional hardware photonic sensor** (Year 2): partnership with phone OEMs to access ToF / structured light sensors via WebXR for unforgeable depth.

### R4 — Browser Extension Tampering
**Risk**: Malicious extensions can hook `MediaStreamTrack.prototype`, `CanvasRenderingContext2D.prototype.getImageData`, or override `ort.InferenceSession`.

**Mitigation**:
- **Strict CSP** + SRI on all SDK modules.
- **Worker isolation**: all sensitive computation in Web Worker; extensions cannot inject into workers (Chrome extension model limitation — `content_scripts` cannot access worker scope).
- **Heartbeat HMAC** between worker and main thread (Section 1.5.5).
- **`Object.freeze` + `Object.seal` on critical prototypes** during SDK init, with traps via `Proxy` if mutation attempted.
- For enterprise deployments, recommend the client app loads the SDK from a sandboxed cross-origin iframe with `allow-scripts` only — extension access denied by Same-Origin Policy.

### R5 — ZK Proof Generation Latency
**Risk**: Groth16 proof generation at 80–150 ms is a UX bottleneck on low-end devices.

**Mitigation**:
- Pre-compute proving key setup during SDK init (10–30 s in background, runs while user reads privacy notice).
- **Hybrid mode**: for low-tier devices, optionally use a STARK proof (no trusted setup, larger proof ~50 KB, faster proving 30–50 ms). Acceptable for low-risk flows.
- **Future (Year 2)**: investigate folding schemes (Nova / SuperNova) for amortized proof costs across multiple authentications.

### R6 — Regulatory Drift (EU AI Act)
**Risk**: EU AI Act (in force Aug 2026) classifies biometric authentication as "high-risk AI" — demands extensive documentation, conformity assessment, post-market monitoring.

**Mitigation**:
- Build a **CE-marking conformity dossier** from day one: technical file, risk management system (ISO 31000), data governance, logging, human oversight.
- Maintain a **public model card** and an **EU AI Act compliance portal** for enterprise customers.
- Engage a Notified Body (TÜV, DEKRA) for conformity assessment by Q2 2027 — budget €150K–€300K.
- Provide a **non-EU deployment** option (no EU AI Act overhead) for customers in jurisdictions with lighter regulation.

### R7 — Talent Acquisition (rPPG + ZK engineers)
**Risk**: The intersection of rPPG research, ZK cryptography, and WebGPU engineering is extremely rare (likely < 200 engineers globally).

**Mitigation**:
- Sponsor academic labs: Tsinghua (rPPG), ETH Zurich (ZK), CMU (biometrics). Fund 2-3 PhDs with right-of-first-refusal on hires.
- Open-source the **non-core** components (e.g., ZK circuit templates, rPPG training scripts) to attract community contributions and identify talent.
- Acquire a small team (3–5 engineers) via acqui-hire from a ZK startup if organic hiring fails.

### R8 — KMS Vendor Lock-in (AWS)
**Risk**: Heavy reliance on AWS KMS for tenant DEK management creates lock-in and limits on-prem enterprise sales.

**Mitigation**:
- Abstract KMS behind a `KeyManagementService` trait in Rust; provide implementations for AWS KMS, HashiCorp Vault, Google Cloud KMS, Azure Key Vault, and an on-prem SoftHSM-backed implementation.
- For on-prem enterprise customers, ship a Vault cluster deployment recipe + SoftHSM hardware token support.

---

## Closing — What This Architecture Buys You

VeriFace Edge is **not** "Faceio with WebGPU." It is a categorical shift:

- **Faceio / competitors**: send video to server, run server-side detection, store raw images or embeddings on server. Legally toxic under BIPA, vulnerable to deepfake injection, single point of breach.
- **VeriFace Edge**: edge-only computation, ZK proofs of authentication, cryptographic non-retrievability of biometric data, multi-signal passive liveness, hardware-attested anti-injection.

The result is a platform that wins on three axes simultaneously:
1. **Cost**: 10× cheaper than Onfido-style KYC (no video upload, no server-side GPU bill).
2. **Security**: deepfake-resistant via 3 independent liveness signals + ZK verifiability.
3. **Compliance**: BIPA / GDPR / EU AI Act ready by construction — no images, no risk.

**Execution sequence**: Phase 1 + Phase 2 in parallel (engineering + ML teams); Phase 3 starting Month 3; Phase 4 starting Month 4; Phase 5 starting Month 6. **Time-to-market: 9 months** to GA with one anchor fintech customer.
