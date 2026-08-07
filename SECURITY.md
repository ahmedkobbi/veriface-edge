# VeriFace Edge — SECURITY POLICY

## 🔒 Supported Versions

We actively support the following versions of VeriFace Edge with security updates:

| Version | Supported          |
|---------|--------------------|
| 1.x     | ✅ Active support   |
| < 1.0   | ❌ Not supported    |

## 🛡️ Reporting a Vulnerability

**DO NOT open a public GitHub issue for security vulnerabilities.**

Instead, report vulnerabilities privately via GitHub Security Advisories:

1. Go to **https://github.com/ahmedkobbi/veriface-edge/security/advisories/new**
2. Click **"Report a vulnerability"**
3. Fill in the details:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected components (SDK, API, crypto, etc.)
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

| Stage | Target |
|-------|--------|
| Initial acknowledgement | 48 hours |
| Triage + severity assessment | 5 business days |
| Fix or mitigation | 30 days (high severity), 90 days (others) |
| Coordinated public disclosure | After fix is released |

### What to Include

To help us triage quickly, please include:

- **Description**: Clear description of the vulnerability
- **Reproduction**: Step-by-step instructions (code, HTTP requests, etc.)
- **Impact**: Worst-case scenario if exploited
- **Affected versions**: Specific versions affected (if known)
- **Suggested fix**: If you have ideas on how to fix it

### What NOT to Include

- Actual exploited data (real face images, real user credentials)
- Live exploit code targeting production systems
- Demos against real users

## 🏆 Recognition

With your permission, we'll credit you in:
- The GitHub Security Advisory
- The release notes for the fix
- Our Hall of Fame (coming soon)

## 🔐 Security Measures

VeriFace Edge implements the following security measures:

### Cryptography
- Ed25519 signatures (@noble/ed25519 / CryptoKit / BouncyCastle)
- X25519 ECDH key agreement
- AES-256-GCM authenticated encryption
- BLAKE3 hashing (Pedersen commitments, replay protection)
- HKDF-SHA256 key derivation
- All comparisons are constant-time

### Authentication
- bcrypt password hashing (10 rounds)
- Ed25519-signed JWT in httpOnly cookies (7-day expiry)
- 2FA/TOTP with backup codes
- WebAuthn/FIDO2 hybrid flow
- SAML SSO (Okta, Azure AD, OneLogin)
- HMAC request signing (timestamp + nonce + signature)

### Authorization
- API key scoping (tenant:admin, session:init, session:verify, audit:read, *)
- Tenant isolation (every query scoped to tenantId)
- RBAC for admin panel (admin, user)
- Per-route body size limits

### Anti-Abuse
- Two-tier rate limiting (per-minute + monthly quota per plan tier)
- SSRF protection (15 private IP patterns + DNS rebinding defense)
- CORS fail-closed in production
- PII redaction in error messages
- Audit log tamper-evident hash chain

### Privacy
- 100% on-device biometric computation
- Zero-knowledge Pedersen commitments (backend can't reconstruct face)
- End-to-end encrypted embedding transport
- GDPR Art. 7 consent enforcement
- GDPR Art. 17 right to be forgotten (crypto-erasure)

### Infrastructure
- HTTP/3 (QUIC) via Caddy
- Strict CSP with Trusted Types
- HSTS preload-ready
- Non-root Docker container
- Encrypted database backups (S3, rotation)

## 📋 Threat Model

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full STRIDE analysis.

## 🔑 Secret Rotation

See [docs/SECRETS_ROTATION.md](docs/SECRETS_ROTATION.md) for the rotation procedure for:
- Server signing key (Ed25519)
- Tenant webhook secrets
- API keys
- 2FA backup codes
- Database encryption keys (KMS CMK)

## 📞 Contact

- **Security Advisories**: https://github.com/ahmedkobbi/veriface-edge/security/advisories/new
- **General security questions**: Open a discussion at https://github.com/ahmedkobbi/veriface-edge/discussions

## 📜 License

VeriFace Edge is licensed under the [MIT License](LICENSE).
