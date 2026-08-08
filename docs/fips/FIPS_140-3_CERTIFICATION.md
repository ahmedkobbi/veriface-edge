# VeriFace Edge — FIPS 140-3 Certification Path

## Overview

This document describes the path to FIPS 140-3 certification for VeriFace Edge, enabling deployment in U.S. government (FedRAMP, DoD) and regulated industry (healthcare, finance) environments.

## What is FIPS 140-3?

FIPS 140-3 (Federal Information Processing Standards Publication 140-3) is a U.S. government standard that specifies security requirements for cryptographic modules. It's required for:

- **Federal agencies** (via FISMA / FedRAMP)
- **Department of Defense** (via DoD CC SRG)
- **Healthcare** (via HIPAA — recommended)
- **Finance** (via GLBA — recommended)
- **Critical infrastructure** (via EO 14028)

### Security Levels

| Level | Description | VeriFace Target |
|-------|-------------|----------------|
| Level 1 | Software-only, no physical protection | ✅ Minimum |
| Level 2 | Tamper-evident, role-based auth | ⬜ Optional |
| Level 3 | Tamper-resistant, identity-based auth, port-level protection | ✅ Target (CloudHSM) |
| Level 4 | Tamper-responsive, environmental protection | ⬜ Not needed |

**Target: Level 3** (via AWS CloudHSM or PKCS#11 HSM)

---

## FIPS Boundary

The FIPS boundary defines what is inside the cryptographic module (subject to FIPS requirements) vs. what is outside (not subject to FIPS).

### Inside the Boundary

| Component | Implementation | FIPS-Validated? |
|-----------|---------------|-----------------|
| AES-256-GCM | BoringCrypto / CloudHSM | ✅ Yes |
| SHA-256 / SHA-384 | BoringCrypto / CloudHSM | ✅ Yes |
| ECDSA P-256 | BoringCrypto / CloudHSM | ✅ Yes |
| ECDH P-256 | BoringCrypto / CloudHSM | ✅ Yes |
| HKDF-SHA-256 | BoringCrypto | ✅ Yes |
| HMAC-SHA-256 | BoringCrypto | ✅ Yes |
| DRBG (CTR_DRBG) | BoringCrypto / CloudHSM | ✅ Yes |
| Self-tests | Custom (see below) | N/A (part of module) |

### Outside the Boundary

| Component | Why Outside |
|-----------|------------|
| Next.js application | Business logic — not cryptographic |
| PostgreSQL | Stores encrypted data, not keys |
| TLS (Caddy) | Separate FIPS boundary (OS-level) |
| SDK (client) | Runs on user device — separate boundary |
| Monitoring | No crypto operations |

### Algorithm Changes in FIPS Mode

| Algorithm | Default (non-FIPS) | FIPS Mode | Reason |
|-----------|-------------------|-----------|--------|
| Signatures | Ed25519 | ECDSA P-256 | Ed25519 not in FIPS 186-5 |
| Key agreement | X25519 | ECDH P-256 | X25519 not FIPS-approved |
| Hashing (commitment) | BLAKE3 | SHA-256 | BLAKE3 not FIPS-approved |
| Symmetric encryption | AES-256-GCM | AES-256-GCM | ✅ No change |
| Key derivation | HKDF-SHA-256 | HKDF-SHA-256 | ✅ No change |
| Post-quantum (ML-DSA-87) | Hybrid mode | FIPS 204 | FIPS 204 approved (separate from 140-3) |

---

## Crypto Providers

### 1. Software (Default — NOT FIPS-validated)

```
CRYPTO_PROVIDER=software
```

- Uses `@noble/curves` + `@noble/hashes` + `@noble/ciphers`
- Ed25519, X25519, BLAKE3 (non-FIPS algorithms)
- Suitable for: Development, testing, non-regulated industries
- **NOT FIPS-compliant**

### 2. BoringCrypto (FIPS 140-3 validated)

```
CRYPTO_PROVIDER=boringssl
FIPS_MODE=true
```

- Uses Node.js built-in `crypto` module compiled with BoringSSL `--fips`
- FIPS certificate: [#4460](https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate/4460) (Node.js 18+)
- Algorithms: ECDSA P-256, ECDH P-256, AES-256-GCM, SHA-256, HKDF
- Key generation: In software (but FIPS-validated DRBG)
- **FIPS 140-3 Level 1**

**Setup**:
```bash
# Build Node.js with BoringSSL FIPS
# Or use the official FIPS-validated Node.js build
# https://nodejs.org/api/crypto.html#fips-mode

# In production:
export NODE_OPTIONS=--enable-fips
export CRYPTO_PROVIDER=boringssl
export FIPS_MODE=true
```

### 3. AWS CloudHSM (FIPS 140-3 Level 3)

```
CRYPTO_PROVIDER=cloudhsm
FIPS_MODE=true
AWS_CLOUDHSM_CLUSTER_ID=cluster-xxxxx
AWS_CLOUDHSM_KEY_LABEL=veriface-signing-key
```

- Uses AWS CloudHSM (hardware-backed HSM)
- FIPS certificate: [#4525](https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate/4525)
- Key generation: **Inside HSM** (never leaves hardware)
- Key storage: **Inside HSM** (never extractable)
- All crypto operations: **Inside HSM** (via PKCS#11 interface)
- **FIPS 140-3 Level 3** ✅ (target)

**Setup**:
```bash
# 1. Create CloudHSM cluster
aws cloudhsmv2 create-cluster --hsm-type hsm1.medium --subnet-ids subnet-xxx --security-group-ids sg-xxx

# 2. Initialize cluster
aws cloudhsmv2 initialize-cluster --cluster-id cluster-xxx --signed-cert cert.pem --trust-anchor trust.pem

# 3. Install CloudHSM client
# Follow: https://docs.aws.amazon.com/cloudhsm/latest/userguide/getting-started.html

# 4. Configure VeriFace Edge
export CRYPTO_PROVIDER=cloudhsm
export FIPS_MODE=true
export AWS_CLOUDHSM_CLUSTER_ID=cluster-xxxxx
```

### 4. PKCS#11 HSM (Generic — Thales, Utimaco, YubiHSM)

```
CRYPTO_PROVIDER=pkcs11
FIPS_MODE=true
PKCS11_LIB_PATH=/usr/lib/softhsm/libsofthsm2.so
PKCS11_SLOT=0
PKCS11_PIN=your-pin
```

- Uses any FIPS-validated PKCS#11 HSM
- Supported: Thales Luna, Utimaco SecurityServer, YubiHSM 2
- Key generation + storage: Inside HSM
- **FIPS 140-3 Level 3** (if HSM is Level 3 validated)

---

## Self-Tests (FIPS 140-3 Requirement)

FIPS 140-3 requires the following self-tests:

### Power-Up Self-Tests (run on module initialization)

| Test | What It Verifies | Implementation |
|------|-----------------|----------------|
| AES-256-GCM KAT | Known-answer test (encrypt + decrypt round-trip) | `runFipsSelfTests()` |
| SHA-256 KAT | Known-answer test (hash of known input) | `runFipsSelfTests()` |
| HKDF KAT | Known-answer test (key derivation) | `runFipsSelfTests()` |
| DRBG test | Random number generator uniqueness | `runFipsSelfTests()` |
| Algorithm compliance | All configured algorithms are FIPS-approved | `runFipsSelfTests()` |

### Conditional Self-Tests (run during operation)

| Test | When | Implementation |
|------|------|----------------|
| DRBG health check | Before each key generation | `crypto.randomBytes` (built-in) |
| Key pair consistency | After key generation | Verify public key matches private key |

### Critical Function Self-Tests

| Test | What It Verifies |
|------|-----------------|
| AES-GCM integrity | Auth tag verification on decrypt |
| ECDSA signature | Verify-then-sign round-trip |

---

## Certification Process

### Step 1: Prepare the Module

1. Set `CRYPTO_PROVIDER=boringssl` (or `cloudhsm` for Level 3)
2. Set `FIPS_MODE=true`
3. Run self-tests: `curl -X POST https://api.veriface.io/api/admin/fips`
4. Verify all tests pass
5. Document the FIPS boundary (above)

### Step 2: Engage a NIST-Accredited Lab

| Lab | Expertise | Cost | Timeline |
|-----|-----------|------|----------|
| **InfoGard** | Crypto module testing | $30K-$50K | 3-6 months |
| **Acumen Security** | FIPS 140-3, software modules | $25K-$40K | 3-6 months |
| **UL** | Hardware + software modules | $35K-$55K | 4-8 months |
| **atsec** | FIPS 140-3 + Common Criteria | $30K-$50K | 3-6 months |

### Step 3: Testing + Validation

1. Submit module to lab for testing
2. Lab verifies:
   - Cryptographic algorithm correctness (KATs)
   - Self-test implementation
3. Lab submits report to NIST CMVP
4. NIST reviews + issues certificate

### Step 4: Maintenance

- Annual re-validation (algorithm updates)
- Re-validation on module changes (if security-relevant)
- Notify NIST of any changes to the module

---

## FIPS Status API

```
GET /api/admin/fips
```

Returns:
```json
{
  "fipsMode": true,
  "provider": "boringssl",
  "hardwareKeyGen": false,
  "moduleVersion": "1.0.0",
  "certificateNumber": null,
  "fipsApproved": true,
  "selfTestsPassed": true,
  "algorithms": {
    "signature": "ecdsa-p256",
    "keyAgreement": "ecdh-p256",
    "symmetric": "aes-256-gcm",
    "hash": "sha-256",
    "kdf": "hkdf-sha-256"
  },
  "boundary": {
    "inside": ["AES-256-GCM", "SHA-256", "ECDSA P-256", ...],
    "outside": ["Next.js application", "PostgreSQL", ...]
  }
}
```

---

## References

- [FIPS 140-3 Standard](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.140-3.pdf)
- [NIST CMVP (Cryptographic Module Validation Program)](https://csrc.nist.gov/projects/cryptographic-module-validation-program)
- [FIPS 140-3 Implementation Guidance](https://csrc.nist.gov/Projects/cryptographic-module-validation-program/fips-140-3-ig)
- [AWS CloudHSM FIPS Documentation](https://docs.aws.amazon.com/cloudhsm/latest/userguide/fips.html)
- [Node.js FIPS Mode](https://nodejs.org/api/crypto.html#fips-mode)
- [BoringCrypto FIPS Certificate](https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate/4460)
