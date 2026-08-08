# VeriFace Edge — Disaster Recovery Plan

## Overview

This document defines the Recovery Time Objective (RTO), Recovery Point Objective (RPO), and disaster recovery procedures for VeriFace Edge.

---

## 📊 Recovery Objectives

### RTO/RPO by System Component

| Component | RTO | RPO | Backup Frequency | Backup Retention |
|-----------|-----|-----|------------------|------------------|
| **Primary Database (PostgreSQL)** | 15 min | 5 min | Every 6 hours + continuous WAL | 30 days (S3) |
| **Audit Log (PostgreSQL)** | 30 min | 0 min | Continuous (logical replication) | 7 years (compliance) |
| **Biometric Templates (encrypted)** | 15 min | 5 min | With primary DB | 30 days (S3) |
| **API Server** | 5 min | N/A | Stateless — no backup needed | N/A |
| **Web SDK (CDN)** | 5 min | N/A | Stateless — redeploy from git | N/A |
| **ZK Proving Key (CDN)** | 1 hour | N/A | Regenerate via `scripts/zk-trusted-setup.sh` | N/A |
| **ZK Verification Key (backend)** | 1 hour | N/A | Regenerate with proving key | N/A |
| **Email Queue** | 30 min | 0 min | In-database (no separate backup) | N/A |
| **Stripe/NowPayments Config** | 5 min | N/A | Configuration in env vars + Stripe Dashboard | N/A |
| **TLS Certificates** | 1 hour | N/A | Auto-renewed via Let's Encrypt / Caddy | N/A |

### Definitions

- **RTO (Recovery Time Objective)**: Maximum acceptable time to restore service after an outage.
- **RPO (Recovery Point Objective)**: Maximum acceptable data loss measured in time.
- **WAL (Write-Ahead Log)**: PostgreSQL's transaction log — enables point-in-time recovery.

---

## 🗄️ Backup Strategy

### Backup Schedule

| Backup Type | Frequency | Retention | Storage | Encryption |
|-------------|-----------|-----------|---------|------------|
| **Full database backup** | Every 6 hours | 30 days | S3 (KMS-encrypted) | AES-256-GCM |
| **WAL archive** | Continuous | 7 days | S3 (KMS-encrypted) | AES-256-GCM |
| **Daily snapshot** | 1×/day at 03:00 UTC | 90 days | S3 Glacier | AES-256-GCM |
| **Monthly archive** | 1×/month on 1st | 7 years | S3 Glacier Deep Archive | AES-256-GCM |

### Backup Encryption

All backups are encrypted with **AES-256-GCM** (military-grade):

- **Key**: 32-byte (256-bit) random key stored in AWS KMS / HashiCorp Vault
- **IV**: 12-byte (96-bit) random IV per backup (never reused)
- **Auth tag**: 16-byte (128-bit) — detects tampering
- **Round-trip verification**: every backup is decrypted + SHA-256 verified after encryption

### Backup Integrity

- **SHA-256 hash** computed for both encrypted + decrypted backup
- **Manifest JSON** stored alongside each backup with:
  - Backup ID + timestamp
  - Original + encrypted SHA-256 hashes
  - Encryption IV + algorithm
  - S3 URI + bucket
  - Retention policy
- **Integrity check** on restore: SHA-256 verified before database is overwritten

### Running Backups

```bash
# Set required env vars
export DATABASE_URL="postgresql://..."
export BACKUP_ENCRYPTION_KEY=$(openssl rand -hex 32)  # Store in KMS/Vault
export BACKUP_S3_BUCKET="veriface-backups"
export BACKUP_S3_KMS_KEY_ID="arn:aws:kms:us-east-1:..."

# Run backup
bash scripts/backup-db.sh

# Schedule via cron (every 6 hours):
# 0 */6 * * * /home/veriface/scripts/backup-db.sh >> /var/log/veriface-backup.log 2>&1
```

### Restoring from Backup

```bash
# Restore from local file
bash scripts/restore-db.sh /backups/veriface-backup-2026-01-15-030000Z.db.enc

# Restore from S3
bash scripts/restore-db.sh s3://veriface-backups/backups/api-us/2026-01-15/veriface-backup-2026-01-15-030000Z.db.enc
```

The restore script:
1. Downloads the encrypted backup (from local or S3)
2. Verifies the encrypted SHA-256 (detects corruption)
3. Decrypts with AES-256-GCM
4. Verifies the decrypted SHA-256 (detects key mismatch)
5. Runs SQLite/PostgreSQL integrity check
6. **Backs up the current database** (safety net)
7. Restores the decrypted backup
8. Verifies the restored database integrity

---

## 🌐 Multi-Region Failover

### Architecture

```
                    ┌─────────────────┐
                    │  Cloudflare DNS │
                    │  (TTL: 60s)     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  Primary   │  │  Secondary  │  │  Tertiary  │
     │  (us-east) │  │  (eu-west)  │  │  (ap-south) │
     │  Read/Write│  │  Read/Write  │  │  Read/Write │
     └─────┬──────┘  └──────┬─────┘  └──────┬─────┘
           │                │                │
           └────────────────┼────────────────┘
                            │
                    ┌───────┴───────┐
                    │  PostgreSQL   │
                    │  Logical      │
                    │  Replication  │
                    │  (async, <1s) │
                    └───────────────┘
```

### Failover Procedure

1. **Detection**: Health check fails on primary (3 consecutive failures)
2. **DNS update**: Cloudflare API updates A record to secondary (TTL: 60s)
3. **Propagation**: 1-5 minutes for DNS to propagate globally
4. **Verification**: Health check on failover DNS name
5. **Write activation**: Secondary promoted to primary (if using read replicas)

### Running Failover Tests

```bash
# Dry run (test without actual DNS change)
bash scripts/failover-test.sh --dry-run

# Real failover test
PRIMARY_REGION_URL=https://api-us.veriface.io \
SECONDARY_REGION_URL=https://api-eu.veriface.io \
DNS_PROVIDER=cloudflare \
CLOUDFLARE_API_TOKEN=cf_token \
CLOUDFLARE_ZONE_ID=zone_id \
FAILOVER_DNS_RECORD=api.veriface.io \
bash scripts/failover-test.sh
```

### Failback Procedure

When the primary region is restored:

1. Verify primary is healthy: `curl https://api-us.veriface.io/api/health`
2. Verify replication caught up (no lag): check PostgreSQL replication status
3. Update DNS back to primary: `bash scripts/failover-test.sh --failback`
4. Monitor for 30 minutes
5. Verify no data loss (compare audit log entries)

---

## 📋 Incident Response

See [docs/INCIDENT_RESPONSE_RUNBOOK.md](docs/INCIDENT_RESPONSE_RUNBOOK.md) for the full incident response procedure.

---

## 🔐 Security

- **Backup encryption**: AES-256-GCM with KMS-managed keys
- **Backup integrity**: SHA-256 verification + round-trip decryption test
- **Access control**: Backup scripts run as non-root user with minimal IAM permissions
- **Audit trail**: All backup/restore operations logged to audit chain
- **Key rotation**: Backup encryption key rotated annually (or on personnel change)
- **Offsite storage**: Backups stored in S3 with KMS encryption in a different region

---

## 📚 References

- [PostgreSQL Point-in-Time Recovery](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [AWS S3 Backup Patterns](https://docs.aws.amazon.com/AmazonS3/latest/dev/backup.html)
- [Cloudflare DNS API](https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records)
- [NIST SP 800-34: Contingency Planning Guide](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-34r1.pdf)
