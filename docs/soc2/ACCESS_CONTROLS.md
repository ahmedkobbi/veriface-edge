# VeriFace Edge — Access Control Documentation (SOC 2 CC6)

## Overview

This document describes the logical access controls implemented by VeriFace Edge, mapping to SOC 2 Common Criteria CC6 (Logical and Physical Access Controls).

---

## CC6.1: Logical Access Security Policy

### Role-Based Access Control (RBAC)

VeriFace Edge implements a 3-tier role hierarchy:

| Role | Permissions | Who Has It |
|------|------------|------------|
| **user** | Customer portal access: view own profile, manage own biometric template, view own auth history, manage own notification preferences | All authenticated platform users |
| **admin** | Full admin panel access: manage API keys, templates, team members, billing, security settings, audit log, experiments, telemetry | Tenant owners + designated admins |
| **super-admin** | System-wide: manage all tenants, global settings, cross-tenant data | VeriFace internal staff (production only) |

### API Key Scoping

API keys are scoped to specific operations:

| Scope | Description | Endpoints |
|-------|-------------|-----------|
| `*` | All operations (admin key only) | All `/api/*` endpoints |
| `tenant:admin` | Tenant management | `/api/api-keys/*`, `/api/tenant/*` |
| `session:init` | Initialize sessions | `POST /api/session/init` |
| `session:verify` | Verify sessions | `POST /api/session/verify` |
| `audit:read` | Read audit log | `GET /api/audit`, `GET /api/audit/export` |

### Enforcement

- **Session-based auth** (platform users): Ed25519-signed JWT in httpOnly cookie (7-day expiry)
- **API key auth** (SDK/integrations): SHA-256 hashed key, constant-time comparison
- **Tenant isolation**: Every database query scoped to `tenantId` — enforced at ORM level
- **Admin checks**: Admin endpoints verify `user.role === 'admin'` before processing

---

## CC6.2: User Authentication

### Password Authentication

- **Hashing**: bcrypt with 10 rounds
- **Password requirements**: ≥ 8 chars, 1 uppercase, 1 lowercase, 1 number
- **Lockout**: In-memory failed login tracker (5 attempts → alert, exponential backoff at 5/10/20/50/100)
- **Reset**: Token-based reset (1-hour expiry, single-use)

### Multi-Factor Authentication

- **TOTP**: RFC 6238 compliant, 30-second window, 1-step-before/after tolerance
- **Backup codes**: 8 single-use codes, SHA-256 hashed
- **2FA flow**: Login returns `pendingToken` (5-min, type `two_factor_pending`) → user submits TOTP → full session issued
- **WebAuthn/FIDO2**: Hybrid flow with platform authenticators (Touch ID, Face ID, YubiKey)

### Session Management

- **JWT**: Ed25519-signed (not RS256 — quantum-resistant with ML-DSA-87 hybrid mode)
- **Cookie**: `HttpOnly; Secure; SameSite=Lax` (production: `Secure` enforced)
- **Expiry**: 7 days (platform session), 5 minutes (auth token)
- **Revocation**: `RevokedToken` table (blacklist before expiry)

### API Key Authentication

- **Format**: `vf_live_<32 hex chars>` or `vf_test_<32 hex chars>`
- **Storage**: SHA-256 hashed (plaintext shown ONCE at creation)
- **Verification**: Hash lookup + constant-time comparison
- **Rotation**: Old key can be revoked + new key created without downtime

---

## CC6.3: Access Authorization

### Least Privilege

- Users are granted the minimum scope necessary
- API keys default to `*` scope but can be restricted to specific scopes
- Admin panel access requires `admin` role
- Sensitive operations (key rotation, plan changes, data deletion) require additional confirmation

### Tenant Isolation

- Every Prisma query includes `where: { tenantId }` — enforced at application level
- Missing `tenantId` in a query is treated as a security violation
- Cross-tenant data access is impossible without super-admin privileges

---

## CC6.4: New User Access Provisioning

### Signup Flow

1. User submits email + password
2. Password validated (strength requirements)
3. Email checked for uniqueness
4. bcrypt hash computed
5. Tenant created (with Ed25519 signing key + webhook secret + KMS key ID)
6. Initial API key created (`vf_live_...`, scope `*`)
7. Platform user created (role: `admin`, linked to tenant)
8. Email verification sent
9. User must verify email before API access

### Team Member Invitation

1. Admin invites user via `/api/admin/team` endpoint
2. Invitation creates a PlatformUser with specified role
3. Invitee receives email with setup link
4. Admin can revoke access at any time
5. All team member changes logged to audit chain

---

## CC6.5: Access Modification

### API Key Management

- **Create**: Admin creates key with label + scope + environment + expiry
- **Revoke**: Soft-delete (active=false, revokedAt=timestamp)
- **List**: Admin can view all keys (prefix + last 4 chars only — never full key)
- **Rotate**: Create new key → update SDK config → revoke old key

### Role Changes

- Admin can promote/demote team members
- Role changes logged to audit chain with actor + timestamp
- Session tokens re-issued on role change (old token invalidated)

---

## CC6.6: Access Removal

### API Key Revocation

- Instant: key marked `active=false` in database
- All subsequent requests with revoked key return 401
- Revocation logged to audit chain

### User Deactivation

- Admin can deactivate team members
- Active sessions invalidated (JWT added to `RevokedToken` blacklist)
- API keys remain active (must be revoked separately)
- User data retained (GDPR compliance — deletion requires explicit DSR)

### Data Deletion (GDPR Art. 17)

- User requests deletion via customer portal
- `revokeTemplate()` deletes: BiometricTemplate, User record
- DEK (Data Encryption Key) destroyed via KMS key destruction (crypto-erasure)
- Audit log retains proof of deletion (7-year retention)
- Receipt generated: SHA-256 hash as deletion proof

---

## CC6.7: Access Reviews

### Quarterly Access Review

Automated via `/api/cron/access-review` endpoint:

1. **API Key Review**: List all active API keys, flag keys unused for 90 days
2. **Admin User Review**: List all admin users, flag dormant accounts (no login for 90 days)
3. **Team Member Review**: List all team members per tenant, flag inactive members
4. **Scope Review**: Flag keys with `*` scope (should be minimized)

### Review Process

1. Cron job runs quarterly (schedule: `0 0 1 */3 *` — first day of every quarter)
2. Report generated and stored in audit log
3. Admin reviews report in admin panel
4. Unused keys revoked, dormant accounts deactivated
5. Review completion logged to audit chain

---

## CC6.8: Physical Access

**Not applicable** — VeriFace Edge is a cloud-native SaaS with no physical data centers.

Physical security of cloud infrastructure is the responsibility of:
- **AWS** (RDS, S3, ECS) — covered by AWS SOC 2 Type II report
- **Cloudflare** (CDN, DNS) — covered by Cloudflare SOC 2 Type II report

---

## Credential Management

| Credential Type | Storage | Rotation |
|----------------|---------|----------|
| Server signing key (Ed25519) | Environment variable (AWS Secrets Manager in prod) | Annual or on personnel change |
| ML-DSA-87 post-quantum key | iOS Keychain / Android Keystore | Annual |
| API keys | SHA-256 hashed in database | On revocation or annual rotation |
| Tenant webhook secret | Database (hex) | Via admin panel |
| Tenant DEK | HKDF-derived (not stored) | N/A (derived on demand) |
| Database credentials | Environment variable (Secrets Manager) | Quarterly |
| TLS certificates | Auto-renewed via Let's Encrypt / Caddy | 90 days |
| Stripe API key | Environment variable | Per Stripe Dashboard |
| NowPayments API key | Environment variable | Per NowPayments Dashboard |
| Backup encryption key | AWS KMS | Annual |
