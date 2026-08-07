# VeriFace Edge — Billing Security Audit

## Overview

This document details the security measures implemented in the billing system (Stripe + NowPayments crypto).

## 🔐 Security Architecture

### 5-Layer Webhook Security

Both Stripe and NowPayments webhooks pass through 5 security layers before any business logic runs:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Signature Verification (timing-safe)              │
│  Stripe: stripe.webhooks.constructEvent()                   │
│  NowPayments: HMAC-SHA256 + crypto.timingSafeEqual()       │
│  → Rejects forged webhooks                                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Replay Protection (5-minute window)               │
│  Rejects events where event.created > 5 min ago             │
│  → Prevents replay attacks with old events                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Idempotency (WebhookEvent table)                  │
│  Dedup by (provider, eventId) — Stripe retries 16×,         │
│  NowPayments retries for 24 hours. Each event processed     │
│  exactly once.                                              │
│  → Prevents duplicate invoices/payments/subscriptions       │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Server-Side Price Verification                    │
│  NowPayments: verify body.price_amount matches              │
│  BILLING_PLANS[planTier].priceMonthly (±1% tolerance)       │
│  Stripe: price determined by Stripe Price object, not client│
│  → Prevents price manipulation                              │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: Webhook-Only Business Logic                       │
│  Subscription activation happens ONLY in webhook handlers.  │
│  The success_url redirect is display-only.                  │
│  → Prevents bypass via URL manipulation                     │
└─────────────────────────────────────────────────────────────┘
```

## 📋 Requirement Compliance

### 1. ✅ Never Trust Client-Side Prices

**Implementation:**
- The checkout endpoint (`/api/billing/checkout`) accepts ONLY `planTier` and `interval` from the client.
- The Zod schema explicitly does NOT include a `price` or `amount` field:
  ```ts
  const CheckoutSchema = z.object({
    planTier: z.enum(['growth', 'enterprise']),
    interval: z.enum(['month', 'year']).default('month'),
    // NOTE: No `price` or `amount` field accepted from the client.
  })
  ```
- The actual price is looked up from the server-side `BILLING_PLANS` constant.
- For Stripe: the price is passed as a `priceId` (Stripe Price object) — the client cannot influence the amount.
- For NowPayments: the `price_amount` is set from `BILLING_PLANS[planTier].priceMonthly` — server-computed.
- **NowPayments webhook**: verifies `body.price_amount` matches `BILLING_PLANS[planTier].priceMonthly` (±1% tolerance for crypto fluctuations). If mismatch, the payment is REJECTED and an audit event is logged.

### 2. ✅ Idempotency (Prevent Duplicate Transactions)

**Implementation:**
- New `WebhookEvent` Prisma model tracks every processed webhook event.
- `@@unique([provider, eventId])` constraint prevents duplicates at the database level.
- Stripe event ID: `evt_...` (Stripe's unique identifier)
- NowPayments event ID: `${payment_id}_${payment_status}` (compound key — each status change is a new event)
- Before processing, the handler checks if the event has already been processed:
  ```ts
  const existingEvent = await db.webhookEvent.findUnique({
    where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
  })
  if (existingEvent?.processed) {
    return { received: true, event: event.type, idempotent: true }
  }
  ```
- After processing, the event is marked as `processed: true`.
- If processing fails, the event is marked with `error` and will be retried by Stripe/NowPayments.

**Stripe retry behavior:** Stripe retries webhooks up to 16 times over 3 days (exponential backoff). Without idempotency, each retry would create duplicate invoice/payment records.

### 3. ✅ Webhook Signature Verification (Prevent Spoofing)

**Stripe:**
```ts
event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
```
- Uses Stripe's official `constructEvent` method (timing-safe internally).
- Requires the RAW request body (not parsed JSON) — the webhook route reads `req.text()`.
- Webhook secret: `STRIPE_WEBHOOK_SECRET` env var (from Stripe Dashboard → Webhooks).
- If signature verification fails, returns HTTP 400 immediately.

**NowPayments:**
```ts
const sortedBody = JSON.stringify(body, Object.keys(body).sort())
const expectedSig = crypto.createHmac('sha256', ipnSecret).update(sortedBody).digest('hex')
if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
  return { received: false, error: 'Invalid signature' }
}
```
- HMAC-SHA256 with the IPN secret.
- `crypto.timingSafeEqual` for timing-safe comparison (prevents timing attacks).
- Body is sorted by key before hashing (matches NowPayments' signing algorithm).

### 4. ✅ Webhook-Only Business Logic (Never via success_url)

**Implementation:**
- The `success_url` passed to Stripe/NowPayments is **display-only**:
  ```
  successUrl: `${baseUrl}/admin?tab=rate-limits&checkout=success`
  ```
- This URL simply shows a "Payment successful" message in the admin panel.
- It does NOT call any API endpoint to activate the subscription.
- Subscription activation happens exclusively in the `handleCheckoutCompleted` webhook handler:
  ```ts
  // In the webhook handler (NOT in the success_url redirect):
  await db.subscription.upsert({
    where: { tenantId },
    data: { status: 'active', planTier, ... }
  })
  await db.tenant.update({
    where: { id: tenantId },
    data: { planTier }
  })
  ```
- Even if a user manually visits the `success_url` without paying, nothing happens — the subscription remains inactive until the webhook fires.

### 5. ✅ Replay Protection

**Implementation:**
- Both webhook handlers reject events older than 5 minutes:
  ```ts
  const MAX_WEBHOOK_AGE_SECONDS = 300 // 5 minutes

  const eventAge = Math.floor(Date.now() / 1000) - event.created
  if (eventAge > MAX_WEBHOOK_AGE_SECONDS) {
    return { received: false, error: 'Event too old — possible replay attack' }
  }
  ```
- Stripe events include a `created` timestamp (Unix seconds).
- NowPayments events include a `created_at` timestamp.
- This prevents an attacker from capturing a valid webhook and replaying it later.

## 🔒 Additional Security Measures

### Rate Limiting
- Billing endpoints use `requirePlatformSession` (authenticated users only).
- Webhook endpoints are exempt from session auth (they use signature verification instead).
- Webhook endpoints should be rate-limited at the reverse proxy level (Nginx/Caddy) to prevent DDoS.

### Amount Storage
- All amounts stored in **cents** (integer) — no floating-point arithmetic.
- Prevents rounding errors that could lead to overcharging or undercharging.

### Audit Trail
- Every billing event is logged to the audit chain:
  - `checkout_session_created`
  - `subscription_activated`
  - `subscription_canceled`
  - `crypto_payment_confirmed`
  - `payment_failed`
  - `price_mismatch_rejected` (attack indicator)
- Audit entries are tamper-evident (SHA-256 hash chain).

### Customer Email Source
- The customer email is taken from the authenticated session (`session.user.email`), NOT from the client request body.
- Prevents an attacker from associating a Stripe customer with a different email.

### Fail-Closed Mode
- If `STRIPE_WEBHOOK_SECRET` or `NOWPAYMENTS_IPN_SECRET` is not configured, ALL webhooks are rejected.
- In production, the server refuses to start without these env vars.

### Webhook Event Storage
- The full webhook payload is stored in `WebhookEvent.payload` (JSON) for audit/debugging.
- This allows post-incident investigation without needing to replay events.

## 🧪 Testing Checklist

- [ ] Send a webhook with an invalid signature → should return 400
- [ ] Send a webhook with a valid signature but old timestamp → should return 400 (replay protection)
- [ ] Send the same webhook twice → second should be skipped (idempotent)
- [ ] Send a NowPayments webhook with a mismatched price → should return 400 (price verification)
- [ ] Visit the `success_url` without paying → subscription should remain inactive
- [ ] Complete a checkout → webhook should activate subscription within seconds

## 📚 References

- [Stripe Webhook Security](https://stripe.com/docs/webhooks#verify-events)
- [NowPayments IPN Documentation](https://nowpayments.io/payment-ipn)
- [OWASP: Webhook Security](https://cheatsheetseries.owasp.org/cheatsheets/Web_Application_Security_Testing_Cheat_Sheet.html)
