# VeriFace Edge — Vendor Management (SOC 2 CC9.2)

## Overview

This document describes the vendor management process for VeriFace Edge, mapping to SOC 2 Common Criteria CC9.2 (Vendor and Business Partner Risk Management).

---

## Vendor Inventory

### Critical Vendors (Access to Customer Data)

| Vendor | Service | Data Accessed | SOC 2 Report | Review Date |
|--------|---------|---------------|-------------|-------------|
| **AWS** | RDS (PostgreSQL), S3 (backups), ECS (compute) | Database, backups, application | [AWS SOC 2 Type II](https://aws.amazon.com/compliance/soc-faqs/) | Annual |
| **Cloudflare** | CDN, DNS, DDoS protection | Static assets (SDK), DNS records | [Cloudflare SOC 2 Type II](https://www.cloudflare.com/trust-hub/compliance/) | Annual |
| **GitHub** | Source code, CI/CD, container registry | Source code, deployment artifacts | [GitHub SOC 2 Type II](https://github.com/about/security) | Annual |
| **Stripe** | Payment processing | Customer email, billing address, payment method | [Stripe SOC 2 Type II](https://stripe.com/trust) | Annual |
| **NowPayments** | Crypto payment processing | Customer email, wallet address, payment metadata | [NowPayments compliance](https://nowpayments.io/compliance) | Annual |
| **AWS SES** | Email delivery (auth alerts, billing) | Email addresses, email content | Covered by AWS SOC 2 | Annual |

### Non-Critical Vendors (No Customer Data)

| Vendor | Service | Data Accessed |
|--------|---------|---------------|
| npm | Package registry (publishing) | Package metadata only |
| pub.dev | Flutter package registry | Package metadata only |
| CocoaPods | iOS package registry | Package metadata only |
| Maven Central | Android package registry | Package metadata only |
| Let's Encrypt | TLS certificates | Domain names only |
| Grafana | Monitoring (self-hosted) | Metrics data (no PII) |
| Prometheus | Metrics collection (self-hosted) | Metrics data (no PII) |

---

## Vendor Risk Assessment

### Assessment Criteria

Each critical vendor is assessed annually on:

| Criterion | Weight | Rating (1-5) |
|-----------|--------|-------------|
| **SOC 2 compliance** | 25% | 5 = Type II current, 1 = no compliance |
| **Data encryption** | 20% | 5 = AES-256 at rest + TLS 1.3, 1 = no encryption |
| **Access controls** | 20% | 5 = MFA + RBAC + audit log, 1 = shared password |
| **Incident response** | 15% | 5 = < 1hr response, 1 = no IR process |
| **Data residency** | 10% | 5 = EU/US regions, 1 = unknown |
| **Sub-processor transparency** | 10% | 5 = full list public, 1 = no disclosure |

### Assessment Results (2026)

| Vendor | Overall Score | Risk Level | Notes |
|--------|--------------|------------|-------|
| AWS | 5.0 | Low | Full SOC 2 Type II, KMS encryption, IAM |
| Cloudflare | 4.8 | Low | SOC 2 Type II, TLS 1.3, DDoS protection |
| GitHub | 4.8 | Low | SOC 2 Type II, 2FA, audit log |
| Stripe | 5.0 | Low | Full SOC 2 Type II, PCI DSS Level 1 |
| NowPayments | 4.0 | Medium | SOC 2 pending, HMAC webhooks, KYC/AML |
| AWS SES | 5.0 | Low | Covered by AWS SOC 2 |

---

## Vendor Onboarding Process

1. **Identify need**: Business requirement for new vendor
2. **Security questionnaire**: Send SOC 2 / security questionnaire to vendor
3. **Review SOC 2 report**: Obtain + review vendor's latest SOC 2 report
4. **Risk assessment**: Score vendor on assessment criteria
5. **Data Protection Agreement (DPA)**: Sign DPA before sharing any customer data
6. **Approval**: Risk assessment approved by management
7. **Integration**: Implement vendor integration with security controls
8. **Monitor**: Add to vendor inventory + annual review schedule

---

## Vendor Offboarding Process

1. **Notify vendor**: Terminate contract per agreement terms
2. **Revoke access**: Remove all API keys, IAM roles, integrations
3. **Data deletion**: Request confirmation of customer data deletion
4. **Verify deletion**: Obtain written confirmation from vendor
5. **Update inventory**: Remove from vendor inventory
6. **Audit trail**: Record offboarding in audit log

---

## Sub-processor Disclosure

VeriFace Edge uses the following sub-processors for customer data:

| Sub-processor | Purpose | Data | Location |
|---------------|---------|------|----------|
| AWS (RDS) | Database hosting | All application data | US-East-1 |
| AWS (S3) | Backup storage | Encrypted backups | US-East-1 |
| AWS (SES) | Email delivery | Email addresses + content | US-East-1 |
| Cloudflare | CDN + DNS | Static SDK files + DNS | Global |
| Stripe | Payment processing | Billing email + payment method | Global |
| NowPayments | Crypto payments | Billing email + wallet address | Global |

Customers are notified 30 days before adding a new sub-processor, per GDPR requirements.

---

## Vendor Security Requirements

All critical vendors must:

1. ✅ Maintain SOC 2 Type II compliance (or equivalent)
2. ✅ Encrypt data at rest (AES-256) and in transit (TLS 1.2+)
3. ✅ Implement MFA for all administrative access
4. ✅ Maintain audit logs with ≥ 1-year retention
5. ✅ Provide breach notification within 72 hours
6. ✅ Support data deletion requests (GDPR Art. 17)
7. ✅ Undergo annual security review by VeriFace
