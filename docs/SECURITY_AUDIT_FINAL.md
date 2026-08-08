# VeriFace Edge — Final Black-Hat Penetration Test Report

**Date:** August 8, 2026
**Tester:** Expert Black-Hat Penetration Tester
**Scope:** Full project — API endpoints, webhooks, crypto, auth, database, network, business logic
**Coverage:** Vulnerabilities from 2010 through August 2026 (OWASP Top 10 2021, CWE Top 25, CVE patterns)
**Files audited:** 40+ critical source files

---

## Executive Summary

**Total findings: 65** (12 CRITICAL, 15 HIGH, 18 MEDIUM, 12 LOW, 8 INFO)

The most urgent issue is **C-1 (JWT verification bypass)**, which allows an attacker with any valid API key to authenticate as ANY user without biometric data. Combined with **C-2 (HMAC bypass)** and **C-3 (billing bypass)**, an attacker can fully compromise the platform at minimal cost.

---

## OWASP Top 10 (2021) Coverage

| Category | Status | Findings |
|----------|--------|----------|
| A01 — Broken Access Control | ❌ FAIL | C-3, C-4, C-5, H-4 |
| A02 — Cryptographic Failures | ❌ FAIL | C-1, C-2, C-7, C-10, H-3, H-13, H-14, M-5 |
| A03 — Injection | ⚠️ PARTIAL | H-5, H-6 (no SQL injection — Prisma parameterizes) |
| A04 — Insecure Design | ❌ FAIL | C-6, C-8, C-12, H-1, H-2, H-10, H-11, H-12 |
| A05 — Security Misconfiguration | ❌ FAIL | C-5, C-9, H-4, H-8, H-9, M-2, M-7 |
| A06 — Vulnerable Components | ⚠️ UNKNOWN | I-7, I-8 |
| A07 — ID & Auth Failures | ❌ FAIL | H-2, H-9, H-10, H-15, C-9 |
| A08 — Software Integrity | ❌ FAIL | C-8, H-14 |
| A09 — Logging Failures | ⚠️ PARTIAL | M-4, M-6, L-4 |
| A10 — SSRF | ✅ GOOD | No findings — SSRF protection well-implemented |

---

## CRITICAL Vulnerabilities (12)

### C-1. JWT Signature Verification Bypass — Attacker-Controlled Verification Key
**CWE-347 · OWASP A02 · File: src/app/api/session/verify/route.ts:159-193**

Server extracts Ed25519 public key from **unverified JWT payload** (`proof.sdk_pubkey`), then uses it to verify the JWT signature. Attacker generates own keypair, signs JWT with own private key, server verifies against attacker's public key → **complete auth bypass without biometric data**.

**Fix:** Bind SDK ephemeral key to session during `/session/init` (store in DB session record or sign with backend key).

### C-2. HMAC Request Signature Verification Uses Empty Key
**CWE-345 · OWASP A02 · File: src/app/api/session/verify/route.ts:112**

`verifyRequestSignature()` called with `authResult.auth.apiKey ?? ''` but `AuthResult` has no `apiKey` field → HMAC computed with empty string key → **attacker can forge valid signatures**.

**Fix:** Use per-API-key HMAC secret stored alongside key hash.

### C-3. Direct Plan Tier Change Bypasses Billing
**CWE-862 · OWASP A01 · File: src/app/api/admin/plan/route.ts:96-136**

Any admin can `PUT /api/admin/plan { planTier: 'enterprise' }` without payment → **unlimited API calls for free**.

**Fix:** Remove `planTier` from PUT schema. Plan changes only via Stripe webhook.

### C-4. IDOR: Cross-Tenant Data Access via GET /api/tenant
**CWE-639 · OWASP A01 · File: src/app/api/tenant/route.ts:83-112**

No tenant scope check → attacker reads other tenants' signingPubKey, webhookUrl, config.

**Fix:** `if (id !== authResult.auth.tenantId) return 403`.

### C-5. IP Blocklist and Access Policies Never Enforced
**CWE-1188 · OWASP A05 · Files: src/lib/auth.ts**

`isIpBlocked()` and `checkAccessPolicy()` exported but never called in auth flow → **blocked IPs continue to access the API**.

**Fix:** Call both inside `requireApiKey()`.

### C-6. Biometric Template Re-Enrollment Breaks Verification (DEK Mismatch)
**CWE-1188 · OWASP A02 · File: src/lib/tenant.ts:99-188**

New `templateSalt` generated on re-enrollment but `user.revocationToken` in DB not updated → DEK mismatch → AES-GCM decryption always fails → **all re-enrollments broken**.

**Fix:** Update `user.revocationToken` on re-enrollment, or use DB value for DEK derivation.

### C-7. Attribute ZK Proof Verification Is a No-Op
**CWE-345 · OWASP A02 · File: src/lib/attribute-proofs.ts:256-273**

Only checks `proof.protocol === 'plonk'` — never calls `snarkjs.plonk.verify()` → **any proof with correct shape is accepted**.

**Fix:** Call `snarkjs.plonk.verify(vkey, publicSignals, proof)`.

### C-8. Audit Log Mutability — DSR Resolution Modifies Hash-Chained Entries
**CWE-581 · OWASP A08 · File: src/app/api/admin/compliance/dsr/route.ts:149-164**

Directly updates existing audit log entry payload → **breaks hash chain**, enables tampering.

**Fix:** Append new entry, never update existing.

### C-9. Backup Codes Not Consumed When Disabling 2FA
**CWE-613 · OWASP A05 · File: src/app/api/auth/2fa/disable/route.ts:48-62**

`consumeBackupCode()` computes remaining array but never persists → **same backup code reusable indefinitely**.

**Fix:** `db.platformUser.update({ data: { twoFactorBackupCodes: JSON.stringify(remaining) } })`.

### C-10. NowPayments Webhook Signature Computed Over Re-Serialized JSON
**CWE-347 · OWASP A02 · File: src/lib/billing.ts:704-714**

Re-serializes parsed JSON (not raw body) → signature mismatch with what NowPayments signed → **unreliable verification**.

**Fix:** Compute HMAC over raw request body.

### C-11. NowPayments Webhook Replay Protection Bypassed via Missing Timestamp
**CWE-294 · OWASP A07 · File: src/lib/billing.ts:727-735**

If `body.created_at` is absent, `eventAge = 0` → `0 > 300` is false → **webhook accepted regardless of age**.

**Fix:** Require `created_at` to be present.

### C-12. Metered Usage Never Reported to Stripe
**CWE-840 · OWASP A04 · File: src/lib/billing.ts:554-579**

`reportUsageToStripe()` logs but doesn't call Stripe API → **tenants never billed for actual usage**.

**Fix:** Implement `stripe.subscriptionItems.createUsageRecord()`.

---

## HIGH Vulnerabilities (15)

| # | Vulnerability | CWE | File | Summary |
|---|--------------|-----|------|---------|
| H-1 | Timing-based user enumeration in login | CWE-208 | auth/login | No bcrypt on missing user → timing reveals valid emails |
| H-2 | No rate limiting on auth endpoints | CWE-307 | auth/* | Brute-force passwords + TOTP at network speed |
| H-3 | Reset/verification tokens stored in plaintext | CWE-256 | auth/* | DB compromise = immediate account takeover |
| H-4 | Session not invalidated on password change | CWE-613 | customer/account | Stolen cookie valid for 7 days after password change |
| H-5 | CSP allows `unsafe-inline` + arbitrary CDN | CWE-79 | middleware.ts | Full XSS possible via stored content |
| H-6 | HTML injection in email templates | CWE-79 | email-notifications | User-controlled vars rendered without escaping |
| H-7 | API key sent in welcome email | CWE-200 | email-notifications | Plaintext key in insecure email channel |
| H-8 | Liveness threshold configurable to 0.1 | CWE-1047 | admin/settings | Anti-spoofing defeated by low threshold |
| H-9 | WebAuthn counter not enforced | CWE-294 | webauthn.ts | Cloned credentials undetected |
| H-10 | TOTP codes have no replay protection | CWE-294 | totp.ts | Same code reusable within 30s window |
| H-11 | Email verification uses GET | CWE-598 | auth/verify-email | Token leaked in logs/history/referrer |
| H-12 | Race condition in monthly usage counter | CWE-362 | rate-limit-tiers | Read-then-write instead of atomic increment |
| H-13 | Webhook secret used as master encryption key | CWE-326 | tenant.ts | DEK derived from non-encryption key |
| H-14 | revokeTemplate doesn't destroy DEK | CWE-212 | tenant.ts | GDPR Art. 17 violation — backups still decryptable |
| H-15 | Bootstrap secret comparison not constant-time | CWE-208 | tenant/route.ts | `!==` instead of `timingSafeEqual` |

---

## MEDIUM Vulnerabilities (18)

| # | Vulnerability | File |
|---|--------------|------|
| M-1 | Body size check only uses Content-Length header | body-limits.ts |
| M-2 | In-memory state not shared across instances | auth.ts, session.ts, etc. |
| M-3 | Session private keys stored in memory with no cap | session.ts |
| M-4 | Audit log payload contains PII in plaintext | audit.ts |
| M-5 | TOTP secret stored in plaintext | schema.prisma |
| M-6 | Logger misses several sensitive fields for redaction | logger.ts |
| M-7 | CSP `require-trusted-types` + `unsafe-inline` is contradictory | middleware.ts |
| M-8 | No SSE connection limit per tenant | audit/stream |
| M-9 | `expiresInDays` not validated on API key creation | api-keys/create |
| M-10 | Team invite temp password in HTTP response | admin/team |
| M-11 | No forced password change on team invite | admin/team |
| M-12 | Public status endpoint leaks business metrics | status/route |
| M-13 | Metrics endpoint unauthenticated in dev | metrics/route |
| M-14 | Health endpoint exposes internal details | health/route |
| M-15 | NowPayments price_amount=0 bypasses verification | billing.ts |
| M-16 | FIPS self-tests cached and never re-run | fips/index.ts |
| M-17 | FIPS SHA-256 KAT is tautological (always passes) | fips/index.ts |
| M-18 | `checkCachedRateLimit` returns wrong shape on cache hit | redis-cache.ts |

---

## LOW Vulnerabilities (12)

| # | Vulnerability | File |
|---|--------------|------|
| L-1 | Session cookie uses SameSite=Lax instead of Strict | platform-auth.ts |
| L-2 | JWT doesn't validate iss or aud claims | platform-auth.ts |
| L-3 | Cookie lacks __Host- prefix | platform-auth.ts |
| L-4 | Audit event types misused for unrelated actions | Multiple |
| L-5 | Webhook backoff schedule off-by-one | webhook.ts |
| L-6 | externalUserId regex allows very long strings | validation.ts |
| L-7 | Hex string validation has no max length | validation.ts |
| L-8 | AuditQuerySchema uses offset but queryAuditLog expects cursor | validation.ts |
| L-9 | CSV export doesn't handle null/undefined values | audit/export |
| L-10 | Redis INCR + EXPIRE race condition | redis-cache.ts |
| L-11 | getEffectivePerMinuteLimit prevents emergency throttling | rate-limit-tiers |
| L-12 | NowPayments body parsed before signature verification | webhook route |

---

## INFO / Defense-in-Depth (8)

| # | Observation |
|---|-------------|
| I-1 | SQLite configured as default DB (refused in production via config.ts) |
| I-2 | Tenant signing key pair generated but never used |
| I-3 | No CSRF protection on cookie-authenticated endpoints |
| I-4 | VERIFACE_ALLOW_INSECURE_DEV footgun if set in production |
| I-5 | Test email endpoint can send to arbitrary addresses |
| I-6 | reportUsageToStripe returns true without reporting |
| I-7 | @noble/post-quantum dependency (pre-standardization, monitor for CVEs) |
| I-8 | No dependency pinning / lockfile audit in CI |

---

## Attack Chain Scenarios

### Scenario 1: Full Account Takeover (C-1 + C-2)
1. Attacker signs up → gets valid API key (Developer plan)
2. Calls `/api/session/init` → gets `sessionId` + `challenge`
3. Generates own Ed25519 keypair
4. Constructs JWT with `proof.sdk_pubkey = <own pubkey>`, signs with own private key
5. Sends forged JWT to `/api/session/verify` → **authenticated as any user**
6. HMAC signature not checked (C-2: empty key) → **no replay protection**

### Scenario 2: Free Enterprise (C-3)
1. Attacker signs up → Developer plan (free)
2. Calls `PUT /api/admin/plan { planTier: 'enterprise' }` → **unlimited API calls, all features**
3. No payment required — billing completely bypassed

### Scenario 3: Cross-Tenant Reconnaissance (C-4)
1. Attacker has API key for Tenant A
2. Calls `GET /api/tenant?id=<tenantB_id>` → gets Tenant B's signingPubKey, webhookUrl, config
3. Uses this info to plan further attacks on Tenant B

### Scenario 4: Billing Fraud (C-10 + C-11 + C-12)
1. Attacker captures a legitimate NowPayments webhook
2. Removes `created_at` field (C-11: replay protection bypassed)
3. Re-serializes JSON and computes HMAC (C-10: signature over re-serialized body)
4. Replays webhook days later → subscription re-activated
5. Usage never reported to Stripe (C-12) → **unlimited free usage**

---

## Immediate Action Items (Priority Order)

1. **Fix JWT verification key binding (C-1)** — Bind SDK key to session during init
2. **Fix HMAC request signature (C-2)** — Use per-key HMAC secret
3. **Remove direct plan tier changes (C-3)** — Stripe webhook only
4. **Add tenant scope check to GET /api/tenant (C-4)**
5. **Enforce blocklist + access policies in requireApiKey (C-5)**
6. **Fix re-enrollment DEK mismatch (C-6)**
7. **Implement actual ZK proof verification (C-7)** — Call snarkjs.plonk.verify()
8. **Stop mutating audit log entries (C-8)**
9. **Consume backup codes in 2FA disable (C-9)**
10. **Fix NowPayments webhook signature + replay (C-10, C-11)**
11. **Implement Stripe usage reporting (C-12)**
12. **Add rate limiting to auth endpoints (H-2)**
13. **Hash reset/verification tokens at rest (H-3)**
14. **Implement session invalidation (H-4)**
15. **Fix CSP to remove unsafe-inline (H-5)**
16. **HTML-escape email template variables (H-6)**

---

## Positive Findings

- ✅ **SSRF protection** — Well-implemented (15 private IP patterns, DNS rebinding defense)
- ✅ **No SQL injection** — Prisma ORM parameterizes all queries
- ✅ **Hash-chained audit log** — Tamper-evident (when not mutated by DSR)
- ✅ **GDPR consent enforcement** — Prior consent required before enrollment
- ✅ **Webhook idempotency** — WebhookEvent table with unique constraint
- ✅ **Stripe webhook signature** — Properly verified with raw body
- ✅ **API key hashing** — SHA-256 hashed, constant-time comparison
- ✅ **Tenant isolation** — Enforced at query level (when IDOR not present)
- ✅ **Input validation** — Zod schemas on most endpoints
- ✅ **Post-quantum signatures** — ML-DSA-87 hybrid mode (FIPS 204)
- ✅ **MPC ceremony** — Perpetual Powers of Tau protocol
- ✅ **Formal ZK verification** — 11/11 checks pass, soundness proof generated
