# VeriFace Edge — Risk Assessment (SOC 2 CC3)

## Overview

This document describes the risk assessment process for VeriFace Edge, mapping to SOC 2 Common Criteria CC3 (Risk Assessment).

---

## CC3.1: Risk Identification

### Threat Modeling (STRIDE)

VeriFace Edge uses the STRIDE methodology to identify threats. The full threat model is documented in `docs/THREAT_MODEL.md`.

| Threat Category | Identified Threats |
|----------------|-------------------|
| **Spoofing** | Forged API keys, stolen credentials, fake SDK payloads, webhook spoofing |
| **Tampering** | Audit log tampering, ZK proof forgery, replay attacks, billing price manipulation |
| **Repudiation** | Denying authentication actions, denying billing events |
| **Information Disclosure** | Biometric data leak, embedding extraction, PII exposure, key leakage |
| **Denial of Service** | API flooding, large payload attacks, database exhaustion, ZK proof spam |
| **Elevation of Privilege** | RBAC bypass, tenant isolation breach, API key scope escalation |

### Risk Register

| Risk ID | Risk | Likelihood | Impact | Risk Level | Mitigation | Residual Risk |
|---------|------|-----------|--------|------------|------------|---------------|
| R001 | Quantum computer breaks Ed25519 | Low (5-10 years) | Critical | Medium | ML-DSA-87 hybrid signatures (post-quantum) | Low |
| R002 | Biometric data breach (embedding leak) | Low | Critical | Medium | ZK proofs (backend never sees embedding), AES-256-GCM encryption, tenant DEK | Low |
| R003 | Webhook spoofing (fake billing event) | Medium | High | Medium | Signature verification (timing-safe), replay protection, idempotency | Low |
| R004 | API key compromise | Medium | High | Medium | SHA-256 hashing, scope restriction, revocation, quarterly access reviews | Low |
| R005 | SQL injection | Low | Critical | Low | Prisma ORM (parameterized queries), Zod input validation | Very Low |
| R006 | XSS / CSRF | Low | High | Low | Trusted Types CSP, HttpOnly cookies, SameSite=Lax, CSRF tokens | Very Low |
| R007 | DDoS attack | Medium | Medium | Medium | Rate limiting (per-minute + monthly), Cloudflare DDoS protection | Low |
| R008 | Insider threat (malicious admin) | Low | Critical | Medium | Audit log (tamper-evident), RBAC, least privilege, access reviews | Medium |
| R009 | Cloud provider outage | Low | High | Low | Multi-region failover, RTO 15 min, RPO 5 min | Low |
| R010 | ZK trusted setup betrayal | Very Low | Critical | Low | PLONK universal setup (updatable SRS), MPC ceremony planned | Very Low |
| R011 | Backup data loss | Low | Critical | Low | AES-256-GCM encryption, S3 offsite, 30-day retention, quarterly restore tests | Very Low |
| R012 | Audit log chain corruption | Low | High | Low | Hash-chained (SHA-256), chain verification endpoint, 7-year retention | Very Low |

---

## CC3.2: Risk Analysis

### Risk Scoring Methodology

Risks are scored on two dimensions:

- **Likelihood** (1-5): Probability of occurrence within 12 months
  - 1 = Very Low (< 1%)
  - 2 = Low (1-10%)
  - 3 = Medium (10-30%)
  - 4 = High (30-60%)
  - 5 = Very High (> 60%)

- **Impact** (1-5): Severity of consequences
  - 1 = Negligible (no user impact)
  - 2 = Low (minor user inconvenience)
  - 3 = Medium (partial service degradation)
  - 4 = High (major service outage or data exposure)
  - 5 = Critical (total outage, data breach, or regulatory violation)

- **Risk Level** = Likelihood × Impact
  - 1-4 = Low
  - 5-9 = Medium
  - 10-15 = High
  - 16-25 = Critical

### Risk Review Schedule

| Risk Type | Review Frequency |
|-----------|-----------------|
| All risks in register | Quarterly |
| New threats (e.g., new CVEs) | Continuous (Dependabot + security advisories) |
| Post-incident | After every SEV-1/SEV-2 incident |
| Annual comprehensive review | Once per year (full re-assessment) |

---

## CC3.3: Risk Mitigation

### Mitigation Strategies

| Strategy | Description | Example |
|----------|-------------|---------|
| **Avoid** | Eliminate the risk by not performing the activity | Not storing raw face images |
| **Mitigate** | Reduce likelihood or impact via controls | AES-256-GCM encryption, RBAC, rate limiting |
| **Transfer** | Shift risk to a third party | Cloud provider SLAs, cyber insurance |
| **Accept** | Acknowledge residual risk | ZK trusted setup (mitigated via MPC ceremony) |

### Control Mapping

Each risk in the register is mapped to specific controls:

- R001 (Quantum threat) → ML-DSA-87 post-quantum signatures, hybrid mode
- R002 (Biometric breach) → ZK proofs, AES-256-GCM, tenant DEK, crypto-erasure
- R003 (Webhook spoofing) → Signature verification, replay protection, idempotency, price verification
- R004 (API key compromise) → SHA-256 hashing, scope restriction, quarterly access reviews
- R005 (SQL injection) → Prisma ORM, Zod validation
- R006 (XSS/CSRF) → Trusted Types CSP, HttpOnly cookies, SameSite
- R007 (DDoS) → Rate limiting, Cloudflare DDoS protection
- R008 (Insider threat) → Audit log, RBAC, access reviews
- R009 (Cloud outage) → Multi-region failover, disaster recovery
- R010 (ZK setup betrayal) → PLONK universal setup, MPC ceremony
- R011 (Backup loss) → Encryption, S3 offsite, restore tests
- R012 (Audit corruption) → Hash chain, verification endpoint

---

## CC3.4: Significant Changes

### Change-Triggered Risk Assessment

When significant changes occur, a risk assessment is performed before deployment:

| Change Type | Risk Assessment Required |
|-------------|------------------------|
| New cryptographic primitive | ✅ Full security review |
| New API endpoint handling PII | ✅ Privacy impact assessment |
| New third-party integration | ✅ Vendor risk assessment |
| Database schema change (PII/biometric) | ✅ Data classification review |
| Infrastructure change (new region, new service) | ✅ Architecture review |
| New SDK platform | ✅ Platform-specific security review |
