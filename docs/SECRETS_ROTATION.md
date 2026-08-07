# VeriFace Edge — Secrets Rotation Guide

**Classification**: Confidential — Operations Team
**Last reviewed**: 2026-08-07

## Secrets Inventory

| Secret | Location | Rotation Cadence | Impact of Rotation |
|--------|----------|-------------------|-------------------|
| `VERIFACE_SERVER_SIGNING_KEY` | Environment variable | Annually | All issued tokens invalidated; users must re-authenticate |
| `VERIFACE_ENCRYPTION_KEY` | Environment variable | Annually | Templates must be re-encrypted (migration script) |
| Tenant signing keys | Database (`Tenant.signingPubKey`) | Annually or on compromise | SDK config update required; 24h overlap |
| Tenant API keys | Database (`ApiKey.keyHash`) | Quarterly or on leak | Old keys immediately revoked |
| Tenant webhook secrets | Database (`Tenant.webhookSecret`) | Annually or on leak | Receivers must update signature verification |
| KMS DEKs | AWS KMS / HashiCorp Vault | On template deletion (crypto-erasure) | Encrypted blobs become unrecoverable |
| Database credentials | Environment variable | Quarterly | Brief connection blip during rotation |
| Cron secret (`CRON_SECRET`) | Environment variable | Annually | Update all cron job configs |

---

## Rotation Procedures

### 1. Server Signing Key (`VERIFACE_SERVER_SIGNING_KEY`)

**Impact**: All issued JWT tokens become invalid. Users must re-authenticate.

**Procedure**:
```bash
# 1. Generate new key
node -e "const {ed25519Generate} = require('./src/lib/crypto-server'); const k = ed25519Generate(); console.log(Buffer.from(k.privateKey).toString('hex'))"

# 2. Update environment variable (zero-downtime via blue-green deploy)
# Old server keeps running with old key until drained.
# New server starts with new key.
export VERIFACE_SERVER_SIGNING_KEY=<new-key>

# 3. Deploy new version
kubectl rollout restart deployment/veriface-edge

# 4. Monitor for auth failures (users re-authenticating)
kubectl logs -f deployment/veriface-edge | grep "auth.failure"

# 5. After 24h, remove old key from secrets manager
```

### 2. Tenant Signing Key

**Impact**: SDK must be updated with new key. 24h overlap window.

**Procedure**:
```bash
# 1. Rotate via API (creates new key, old key valid for 24h)
curl -X POST https://api.veriface.io/api/tenant/rotate-signing-key \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'

# 2. Update SDK config with new signingPrivateKey
# 3. Deploy updated SDK to all clients
# 4. After 24h, old key is automatically purged
```

### 3. Tenant API Key

**Impact**: Applications using the old key lose access immediately on revocation.

**Procedure**:
```bash
# 1. Create new API key (overlapping with old)
curl -X POST https://api.veriface.io/api/api-keys/create \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"label":"Production 2026-08","scopes":"*"}'

# 2. Update all applications to use the new key
# 3. Verify new key works
# 4. Revoke old key
curl -X POST https://api.veriface.io/api/api-keys/revoke \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"apiKeyId":"<old-key-id>"}'
```

### 4. Tenant Webhook Secret

**Impact**: Webhook receivers must update their signature verification.

**Procedure**:
```bash
# 1. Rotate webhook secret
curl -X POST https://api.veriface.io/api/tenant/webhook \
  -H "Authorization: Bearer vf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"webhookSecret":"rotate"}'

# 2. Update webhook receiver with new secret
# 3. Test signature verification
```

### 5. Encryption Key (`VERIFACE_ENCRYPTION_KEY`)

**Impact**: All encrypted templates must be re-encrypted. Requires downtime.

**Procedure** (requires maintenance window):
```bash
# 1. Put service in maintenance mode
# 2. Run re-encryption migration script
bun run scripts/re-encrypt-templates.ts --old-key <old> --new-key <new>
# 3. Update VERIFACE_ENCRYPTION_KEY
# 4. Restart service
# 5. Verify templates decrypt correctly
# 6. Remove maintenance mode
```

---

## Emergency Rotation (Compromise)

If a secret is suspected compromised:

1. **Immediately** rotate the affected secret (don't wait for maintenance window)
2. Revoke all active sessions/tokens issued under the old key
3. Audit all access logs for the compromised period
4. Notify affected users (if user data is at risk)
5. File incident report within 24 hours
6. Post-mortem within 7 days

```bash
# Emergency: revoke all tokens
curl -X POST https://api.veriface.io/api/admin/revoke-all-tokens \
  -H "Authorization: Bearer vf_live_..." \
  -d '{"reason":"emergency_key_compromise"}'
```

---

## Verification

After rotation, verify:

```bash
# Check new key is in use
curl https://api.veriface.io/.well-known/openid-configuration | jq .id_token_signing_alg_values_supported

# Verify token signature with new key
TOKEN="..." # token issued after rotation
curl -X POST https://api.veriface.io/api/token/verify \
  -H "Authorization: Bearer vf_live_..." \
  -d "{\"token\":\"$TOKEN\"}"

# Check audit log for rotation event
curl https://api.veriface.io/api/audit?eventType=key.rotated \
  -H "Authorization: Bearer vf_live_..."
```

---

## Rotation Calendar

| Secret | Last Rotated | Next Due | Owner |
|--------|-------------|----------|-------|
| Server signing key | — | Annually | DevOps |
| Encryption key | — | Annually | DevOps |
| Database credentials | — | Quarterly | DevOps |
| Tenant keys | — | Annually per tenant | Tenant admin |
| API keys | — | Quarterly per tenant | Tenant admin |
