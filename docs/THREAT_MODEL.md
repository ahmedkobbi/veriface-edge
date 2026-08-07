# VeriFace Edge — Threat Model (STRIDE)

**Document classification**: Confidential — Engineering & Security Teams
**Last reviewed**: 2026-08-07
**Owner**: Principal Biometric Security Architect

---

## 1. System Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser (Trusted computing base — TCB)                          │
│                                                                 │
│  Camera → SDK (WASM + crypto) → Pedersen Commitment + JWT       │
│                                                                 │
│  Threats: extension injection, virtual camera, replay, MITM     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ TLS 1.3 (HSTS, CSP)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Edge / Nginx                                                    │
│                                                                 │
│  Threats: DDoS, header injection, slowloris                     │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Application (Next.js API)                                       │
│                                                                 │
│  Threats: API key leak, auth bypass, tenant escape, SSRF        │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ Database (PostgreSQL / SQLite)                                  │
│                                                                 │
│  Threats: SQL injection, backup leak, privilege escalation      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. STRIDE Analysis

### S — Spoofing (identity forgery)

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Attacker spoofs SDK origin | Malicious JS poses as VeriFace SDK, harvests embeddings | SDK signs JWT with Ed25519 private key; backend verifies against tenant's `signingPubKey`. Per-session ephemeral keys. |
| Attacker spoofs tenant | API call uses another tenant's `tenantId` | Tenant ID is derived from the authenticated API key (`authResult.tenantId`), never from request body. |
| Attacker spoofs user | Submits another user's `externalUserId` during auth | Cosine similarity match against stored template required — attacker without the user's face fails. |
| Attacker spoofs backend | MITM during session init | TLS 1.3 + HSTS + certificate pinning (recommended for SDK). Session ECDH provides forward secrecy. |

### T — Tampering (data modification)

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Attacker tampers with audit log | Modifies `AuditLog` rows to hide activity | Hash-chained (`thisHash = SHA-256(prev || payload || ts || tenant)`). Any modification breaks the chain — `verifyAuditChain()` detects tampering. |
| Attacker tampers with transmitted embedding | Modifies AES-256-GCM ciphertext | GCM auth tag detects any bit flip. Decryption fails, request rejected. |
| Attacker tampers with JWT payload | Modifies claims to escalate privileges | Ed25519 signature verification fails. JWT `exp` enforced. |
| Attacker tampers with SDK code | Modifies SDK JS to bypass checks | SRI (`integrity="sha384-..."`) on script tags. Strict CSP. Worker isolation. |
| Attacker tampers with ZK commitment | Submits a fake commitment | Backend recomputes `BLAKE3(embedding || nonce)` and compares — mismatch = reject. |

### R — Repudiation (denying an action)

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Tenant denies API key creation | Claims audit entry was forged | Audit log entries include `apiKeyId`, `actorIp`, hash-chained. Cryptographically undeniable. |
| User denies authentication | Claims their face was used without consent | Auth tokens include `amr: ['face']`, `acr: 'eidas:substantial'`, `jti` (unique). Audit log records `cosineSimilarity` + `liveness` scores. |
| Tenant denies template deletion | Claims GDPR request was ignored | `RevocationReceipt` is signed by server's Ed25519 key — legally binding proof of deletion. |

### I — Information disclosure (data leak)

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Database leak exposes biometric templates | SQL injection or backup theft | Templates stored as AES-256-GCM ciphertext with per-tenant DEK. Without KMS access, plaintext is unrecoverable. |
| Network sniffing reveals biometric data | TLS interception | All payloads are AES-256-GCM encrypted (ECDH-derived session key). TLS is the outer layer; the inner layer protects against TLS compromise. |
| Server memory dump exposes embeddings | Process memory inspection | Embeddings are wiped (`fill(0)`) immediately after cosine similarity computation. DEKs wiped after use. |
| Log files leak sensitive data | Verbose logging | Audit log stores only event metadata + scalar scores. NEVER raw embeddings, frames, or images. |
| Browser extension reads embedding | Extension hooks into SDK | SDK runs in Web Worker — extension content scripts cannot inject into worker scope. Prototype integrity checks. |

### D — Denial of service

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| API flood | Attacker spams /api/session/init | Rate limiting: 60 req/min per tenant+IP (configurable). 429 response with `Retry-After`. |
| Large payload DoS | Attacker sends huge JWT / embedding | Nginx `client_max_body_size 10M`. API route validates payload structure before processing. |
| Slowloris | Slow HTTP connections exhaust workers | Nginx `client_body_timeout 12s`, `keepalive_timeout 65s`. |
| Session exhaustion | Attacker creates millions of pending sessions | Sessions expire after 60s (configurable). `/api/session/cleanup` cron marks them expired. |
| Camera enumeration DoS | Attacker spams `getUserMedia` to flood device | Browser-native permission gating; one active stream per SDK instance. |

### E — Elevation of privilege

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| API key with `session:init` scope calls admin endpoint | Scope confusion bug | `requireApiKey(req, 'tenant:admin')` enforced on every sensitive route. Scope check is explicit per endpoint. |
| Tenant A accesses Tenant B's data | Cross-tenant query bug | All queries include `WHERE tenant_id = ?` derived from API key. Prisma RLS-style enforcement. |
| User escalates to admin | Missing role check | No user roles in VeriFace — every API call uses tenant API keys, not user logins. Admin operations require `tenant:admin` scope. |
| SQL injection escalates | Unsanitized input in query | Prisma parameterized queries everywhere. No raw SQL. |

---

## 3. Attack Trees

### Attack Tree 1: Steal biometric template

```
Goal: Recover plaintext embedding from VeriFace systems
├── Compromise database (read access)
│   ├── Get encrypted_vector — useless without DEK ❌
│   └── Get commitment — one-way hash, irreversible ❌
├── Compromise KMS (AWS account takeover)
│   └── Decrypt DEK → decrypt templates ✓ (highest impact)
│       Mitigation: KMS access limited to specific IAM roles,
│       MFA required, CloudTrail logs all decrypt calls.
├── Compromise application server (RCE)
│   ├── Read in-memory embeddings — wiped after use ❌
│   ├── Read in-memory DEKs — wiped after use ❌
│   └── Hook crypto functions — possible ✓
│       Mitigation: Secure Enclave for high-tier customers
│       (DEK never leaves enclave, attestation required).
├── Compromise browser extension layer
│   ├── Hook MediaStreamTrack — blocked by worker isolation ❌
│   └── Override ort.InferenceSession — blocked by prototype freeze ❌
└── Social engineering (phishing user)
    └── Get user to enroll on fake site — needs real domain ✓
        Mitigation: tenant pins to specific domains; CSP.
```

### Attack Tree 2: Bypass liveness detection

```
Goal: Authenticate with deepfake / replay
├── Replay pre-recorded video
│   ├── Frame hashing detects duplicates (10-min window) ❌
│   └── Cross-session replay (older than 10 min)
│       └── Backend 7-day rolling hash filter ❌
├── Real-time deepfake (StyleGAN, SimSwap)
│   ├── rPPG signal missing — overall liveness < threshold ❌
│   └── Inject synthetic rPPG
│       └── Phase coherence across ROI sub-regions fails ❌
├── 3D mask attack
│   ├── CDCN micro-texture detects synthetic skin ❌
│   └── Depth heuristic detects planar screen ❌
├── Virtual camera injection (OBS)
│   ├── Label-based denylist ❌
│   └── Frame timing σ/μ < 0.05 detects periodic stream ❌
└── Browser extension hook
    ├── Prototype integrity check fails → EXTENSION_TAMPER ❌
    └── Worker isolation prevents injection ❌
```

### Attack Tree 3: Tenant escape

```
Goal: Tenant A reads Tenant B's biometric data
├── API parameter manipulation
│   ├── Send tenantId=B in body — ignored, derived from API key ❌
│   └── Send externalUserId from tenant B — User not found in tenant A ❌
├── SQL injection in audit query
│   └── Prisma parameterizes all queries ❌
├── JWT tampering
│   └── Ed25519 signature fails ❌
├── Compromise shared infrastructure
│   ├── Single SQLite DB — but separate rows per tenant ⚠️
│   │   Mitigation: Production uses PostgreSQL with separate
│   │   schemas per tenant, or separate DB instances.
│   └── Single KMS CMK — but per-tenant DEKs ❌
└── Insider threat (VeriFace engineer)
    ├── Read DB directly — sees only ciphertext ❌
    └── Read KMS — needs breakglass, logged, MFA ⚠️
```

---

## 4. Residual Risks

| # | Risk | Likelihood | Impact | Mitigation Status |
|---|------|-----------|--------|-------------------|
| R1 | KMS compromise (AWS account takeover) | Low | Catastrophic | Mitigated by IAM scoping + MFA + CloudTrail. Insurance coverage. |
| R2 | Quantum computer breaks Ed25519 | Very Low (10+ years) | High | Post-quantum signature scheme migration planned (Year 3). |
| R3 | Deepfake advances to synthesize rPPG | Medium (2027+) | High | Multi-signal defense + continuous red-team + federated model updates. |
| R4 | Browser extension uses zero-day to bypass worker isolation | Low | High | Sandboxed iframe deployment for high-security tenants. |
| R5 | Insider steals signing key | Low | High | Split knowledge — key generated by HSM, never exported. Annual rotation. |
| R6 | SQLite corruption in production | Medium (if used in prod) | Medium | Production MUST use PostgreSQL. SQLite is dev-only. |

---

## 5. Security Headers Checklist

All responses include:
- [x] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- [x] `X-Frame-Options: DENY`
- [x] `X-Content-Type-Options: nosniff`
- [x] `Referrer-Policy: strict-origin-when-cross-origin`
- [x] `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; connect-src 'self'`

---

## 6. Compliance Mapping

| Framework | Requirement | Implementation |
|-----------|-------------|----------------|
| GDPR Art. 25 | Privacy by Design | Edge-only computation, no raw images on server |
| GDPR Art. 17 | Right to be Forgotten | `/api/templates/delete` + KMS DEK destruction |
| GDPR Art. 32 | Security of Processing | AES-256-GCM + per-tenant keys + secure enclaves (enterprise) |
| BIPA | No face geometry collection | Only irreversible embedding stored, not face geometry |
| ISO/IEC 30107-3 | PAD certification | Architecture supports iBeta / TÜV evaluation pathway |
| EU AI Act | High-risk AI conformity | Technical file + risk management system (Year 2 roadmap) |
| SOC 2 Type II | Security & availability | Audit log + access controls + rate limiting (in progress) |
| PSD2 SCA | Strong customer authentication | `amr: ['face']` + `acr: 'eidas:substantial'` in JWT |

---

## 7. Incident Response

### Severity levels

| Level | Description | Response time |
|-------|-------------|---------------|
| SEV-1 | Active data breach / template leak | < 1 hour |
| SEV-2 | Auth bypass / tenant escape | < 4 hours |
| SEV-3 | Liveness bypass / deepfake success | < 24 hours |
| SEV-4 | DoS / performance degradation | < 48 hours |

### Response procedure

1. **Contain**: Revoke affected API keys, disable affected tenants
2. **Investigate**: Walk audit chain, identify scope
3. **Eradicate**: Patch vulnerability, rotate compromised keys
4. **Recover**: Restore from clean backup if needed
5. **Lessons learned**: Post-mortem within 7 days, update threat model

---

## 8. Review Cadence

- **Quarterly**: Threat model review by security team
- **Annually**: Full re-assessment by external auditor (Cure53 / Trail of Bits)
- **Per release**: Regression tests for crypto, auth, tenant isolation
- **Continuous**: Automated scanning (CodeQL, dependency audit)
