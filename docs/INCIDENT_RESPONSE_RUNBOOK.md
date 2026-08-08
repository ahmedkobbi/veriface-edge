# VeriFace Edge — Incident Response Runbook

## 🚨 Quick Reference

| Severity | Definition | Response Time | Escalation |
|----------|-----------|---------------|------------|
| **SEV-1** | Total service outage, data breach, or security incident | 5 min | Page on-call engineer + CTO |
| **SEV-2** | Partial outage, degraded service, or billing failure | 15 min | Page on-call engineer |
| **SEV-3** | Non-critical feature broken, performance degradation | 1 hour | Email on-call engineer |
| **SEV-4** | Minor bug, cosmetic issue | Next business day | Create ticket |

---

## 📞 Contacts

| Role | Name | Phone | Email |
|------|------|-------|-------|
| On-call Engineer | _____ | _____ | oncall@veriface.io |
| CTO | _____ | _____ | cto@veriface.io |
| Security Officer | _____ | _____ | security@veriface.io |
| Legal (for data breaches) | _____ | _____ | legal@veriface.io |

---

## 🔍 Detection

### Automated Alerts

Alerts are configured in Prometheus + Grafana. The following trigger pages:

| Alert | Condition | Severity |
|-------|-----------|----------|
| `ServiceDown` | Health check fails for 3 consecutive checks (15s) | SEV-1 |
| `HighErrorRate` | 5xx error rate > 5% for 5 min | SEV-2 |
| `HighLatency` | P99 latency > 2000ms for 5 min | SEV-2 |
| `DatabaseDown` | DB connection failures > 10 in 1 min | SEV-1 |
| `DiskSpaceLow` | Disk usage > 85% | SEV-3 |
| `MemoryHigh` | Memory usage > 90% for 5 min | SEV-3 |
| `RateLimitHigh` | Rate limit hits > 1000/min | SEV-3 |
| `AuditChainBroken` | Audit log hash chain verification fails | SEV-1 |
| `BackupFailed` | Backup script exits non-zero | SEV-2 |
| `BillingWebhookFailed` | Stripe/NowPayments webhook processing fails | SEV-2 |
| `ZKProofVerificationFailed` | ZK proof verification fails (non-test) | SEV-2 |
| `CertificateExpiring` | TLS cert expires in < 14 days | SEV-3 |

### Manual Reporting

Users can report incidents via:
- **Status page**: https://status.veriface.io
- **Email**: incidents@veriface.io
- **GitHub Issues**: https://github.com/ahmedkobbi/veriface-edge/issues (for non-urgent)

---

## 📋 Incident Response Procedure

### Phase 1: Detection + Triage (0-5 min)

1. **Acknowledge the alert**
   - On-call engineer acknowledges the page within 5 minutes
   - If no acknowledgment in 5 min, escalate to CTO

2. **Assess severity**
   - Determine SEV-1/2/3/4 based on impact
   - If data breach or security incident → SEV-1 + notify Security Officer

3. **Create incident channel**
   - Create Slack channel: `#incident-YYYY-MM-DD-description`
   - Invite on-call engineer, CTO, and relevant team members
   - Pin this runbook to the channel

4. **Start incident log**
   - Record: start time, detector, initial symptoms, severity
   - All subsequent actions must be logged with timestamps

### Phase 2: Containment (5-30 min)

**For service outage:**
1. Check health endpoint: `curl https://api.veriface.io/api/health`
2. Check recent deployments: `git log --oneline -10` + CI/CD logs
3. If bad deployment → **rollback**:
   ```bash
   # Rollback to previous deployment
   kubectl rollout undo deployment/veriface-edge
   # OR if using Docker:
   docker stop veriface-edge && docker start veriface-edge-prev
   ```
4. If database issue → check PostgreSQL status:
   ```bash
   kubectl exec -it postgres-0 -- psql -c "SELECT pg_is_in_recovery();"
   kubectl exec -it postgres-0 -- psql -c "SELECT * FROM pg_stat_replication;"
   ```
5. If region failure → initiate failover:
   ```bash
   bash scripts/failover-test.sh
   ```

**For data breach / security incident:**
1. **DO NOT** delete any logs or evidence
2. Isolate affected systems (do not power off — preserve memory for forensics)
3. Revoke compromised credentials:
   ```bash
   # Rotate server signing key
   openssl rand -hex 32  # New key
   # Update VERIFACE_SERVER_SIGNING_KEY env var + restart
   ```
4. Revoke compromised API keys via admin panel
5. Block malicious IPs via access policies
6. Notify Security Officer + Legal immediately

**For billing failure:**
1. Check Stripe/NowPayments dashboard for outages
2. Verify webhook endpoints are reachable:
   ```bash
   curl -sS https://api.veriface.io/api/billing/stripe/webhook -X POST -d "{}" -H "stripe-signature: test"
   # Should return 400 (invalid signature) — not 500
   ```
3. If webhook backlog → process manually:
   ```bash
   curl -X POST https://api.veriface.io/api/billing/report-usage -H "x-cron-secret: $CRON_SECRET"
   ```

### Phase 3: Eradication (30 min - 2 hours)

1. **Identify root cause**
   - Review logs: `kubectl logs veriface-edge-<pod-id> --tail=1000`
   - Review metrics: Grafana dashboard → specific timeframe
   - Review audit log: `/api/audit?from=<incident-start>`

2. **Apply fix**
   - Patch the vulnerability / fix the bug
   - Deploy via normal CI/CD pipeline (or hotfix if urgent)
   - Verify fix in staging before production

3. **Verify eradication**
   - Run full test suite: `bun test`
   - Monitor error rates for 30 min after fix
   - Check for recurrence of the issue

### Phase 4: Recovery (2-4 hours)

1. **Restore service**
   - Verify all systems operational: `curl https://api.veriface.io/api/health`
   - Verify database integrity:
     ```bash
     # SQLite
     sqlite3 db/custom.db "PRAGMA integrity_check;"
     # PostgreSQL
     psql -c "SELECT pg_is_in_recovery();"
     ```
   - Verify audit log chain integrity: `curl /api/verify-audit`

2. **Verify data integrity**
   - Check for data loss: compare record counts before/after
   - If data loss → restore from backup:
     ```bash
     bash scripts/restore-db.sh s3://veriface-backups/backups/.../latest.enc
     ```

3. **Resume normal operations**
   - Remove any temporary rate limits / IP blocks
   - Re-enable disabled features
   - Notify users via status page

### Phase 5: Post-Incident (within 48 hours)

1. **Write post-mortem**
   - Use the template in `docs/post-mortem-template.md`
   - Include: timeline, root cause, impact, actions taken, lessons learned
   - Review with team within 48 hours

2. **Implement preventive measures**
   - Create tickets for all action items
   - Add monitoring/alerts for the failure mode
   - Update this runbook with new procedures

3. **Update status page**
   - Post incident summary on https://status.veriface.io
   - Include: impact, duration, root cause, preventive measures

---

## 🔧 Common Incidents + Runbooks

### Database Outage

**Symptoms**: `DatabaseDown` alert, API returns 500 errors

**Steps**:
1. Check PostgreSQL status:
   ```bash
   kubectl exec -it postgres-0 -- psql -c "SELECT 1;"
   ```
2. If PostgreSQL is down:
   ```bash
   kubectl rollout restart statefulset/postgres
   ```
3. If disk full:
   ```bash
   kubectl exec -it postgres-0 -- df -h
   # Delete old WAL files or expand disk
   ```
4. If corruption:
   ```bash
   # Restore from backup
   bash scripts/restore-db.sh s3://veriface-backups/.../latest.enc
   ```
5. Verify recovery: `curl /api/health`

### Compromised API Key

**Symptoms**: Unusual API usage, billing alerts, fraud score spike

**Steps**:
1. Identify the compromised key via audit log:
   ```sql
   SELECT "keyPrefix", "lastUsedAt", "label"
   FROM "ApiKey"
   WHERE "tenantId" = '<tenant>'
   ORDER BY "lastUsedAt" DESC;
   ```
2. Revoke the key:
   ```bash
   curl -X POST https://api.veriface.io/api/api-keys/revoke \
     -H "Authorization: Bearer $ADMIN_KEY" \
     -d '{"apiKeyId": "<key-id>"}'
   ```
3. Notify the tenant owner via email
4. Review audit log for unauthorized access:
   ```bash
   curl /api/audit?tenantId=<tenant>\&from=<compromise-time>
   ```
5. If data was accessed → notify affected users + legal

### ZK Proof Verification Failure

**Symptoms**: `ZKProofVerificationFailed` alert, authentication failures spike

**Steps**:
1. Check if verification key is valid:
   ```bash
   python3 -c "import json; v=json.load(open('zk/verification_key.json')); print('protocol:', v.get('protocol'))"
   # Should print: protocol: plonk
   ```
2. If key is missing or wrong protocol:
   ```bash
   # Regenerate from proving key
   npx snarkjs zkey export verificationkey zk/face_verification_final.zkey zk/verification_key.json
   ```
3. Check if circuit changed (without re-running trusted setup):
   ```bash
   # Compare R1CS hash with last known good
   sha256sum zk/face_verification.r1cs
   ```
4. If proving key is corrupted:
   ```bash
   # Re-run trusted setup
   bash scripts/zk-trusted-setup.sh
   ```
5. Temporarily fall back to Pedersen commitment verification:
   ```typescript
   // Set in admin panel: requireZkProof = false
   // This allows authentication to continue while ZK is restored
   ```

### Audit Log Chain Broken

**Symptoms**: `AuditChainBroken` alert — hash chain verification fails

**Steps**:
1. Run full chain verification:
   ```bash
   curl /api/verify-audit?tenantId=<tenant>
   ```
2. Identify the broken entry:
   - The response includes `brokenAt` (chain index)
3. Check if the broken entry was tampered with or if it's a bug
4. If tampering detected → SEV-1 security incident
5. If bug → fix the audit chain logic + recompute hashes from the broken point

---

## 📊 Incident Metrics

Track these metrics for each incident:

- **MTTD** (Mean Time to Detect): Time from incident start to alert
- **MTTA** (Mean Time to Acknowledge): Time from alert to on-call acknowledgment
- **MTTR** (Mean Time to Resolve): Time from alert to resolution
- **Impact**: Number of users affected, requests failed, revenue lost

Target SLAs:
- MTTD: < 5 min (SEV-1/2), < 1 hour (SEV-3/4)
- MTTA: < 5 min (SEV-1/2), < 1 hour (SEV-3/4)
- MTTR: < 1 hour (SEV-1), < 4 hours (SEV-2), < 1 day (SEV-3), < 1 week (SEV-4)

---

## 📚 References

- [Google SRE Book: Incident Response](https://sre.google/sre-book/incident-response/)
- [NIST SP 800-61: Computer Security Incident Handling Guide](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r2.pdf)
- [PagerDuty: Incident Response Documentation](https://response.pagerduty.com/)
