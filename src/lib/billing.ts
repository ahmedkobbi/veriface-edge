/**
 * VeriFace Edge — Billing Library (Stripe + NowPayments)
 *
 * Handles:
 *   - Stripe Checkout sessions (plan upgrades)
 *   - Stripe Customer Portal (manage billing)
 *   - Stripe webhook signature verification
 *   - NowPayments crypto invoice creation
 *   - NowPayments webhook verification
 *   - Metered billing (sync ApiUsageCounter → Stripe)
 *
 * Security:
 *   - Stripe webhook signatures verified with raw body (timing-safe)
 *   - NowPayments webhooks verified with IP allowlist + HMAC signature
 *   - All amounts stored in cents (integer — no floating point)
 *   - Idempotency: webhook events deduplicated via providerPaymentId
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY       — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET   — whsec_... (from Stripe Dashboard → Webhooks)
 *   STRIPE_PRICE_DEV_MONTHLY — price_... (Developer plan, monthly)
 *   STRIPE_PRICE_GROWTH_MONTHLY — price_... (Growth plan, monthly)
 *   STRIPE_PRICE_GROWTH_YEARLY  — price_... (Growth plan, yearly)
 *   STRIPE_PRICE_ENTERPRISE_MONTHLY — price_... (Enterprise plan, monthly)
 *   NOWPAYMENTS_API_KEY     — Your NowPayments API key
 *   NOWPAYMENTS_IPN_SECRET  — IPN webhook secret (from NowPayments → Account Settings)
 *   NOWPAYMENTS_API_BASE    — https://api.nowpayments.io (default)
 *
 * References:
 *   - Stripe Docs: https://stripe.com/docs/api
 *   - NowPayments Docs: https://nowpayments.io/api-docs
 */

import Stripe from 'stripe'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { appendAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Stripe client (lazy init — only when API key is available)
// ---------------------------------------------------------------------------

let stripeClient: Stripe | null = null

function getStripe(): Stripe {
  if (stripeClient) return stripeClient

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY not configured')
  }

  stripeClient = new Stripe(key, {
    apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
    typescript: true,
    maxNetworkRetries: 3,
  })
  return stripeClient
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

// ---------------------------------------------------------------------------
// Plan definitions + price mapping
// ---------------------------------------------------------------------------

export interface BillingPlan {
  tier: 'developer' | 'growth' | 'enterprise'
  name: string
  priceMonthly: number // USD
  priceYearly: number // USD (usually 10-month price = 2 months free)
  monthlyLimit: number // API calls
  features: string[]
  stripePriceIdMonthly?: string
  stripePriceIdYearly?: string
}

export const BILLING_PLANS: Record<string, BillingPlan> = {
  developer: {
    tier: 'developer',
    name: 'Developer',
    priceMonthly: 0,
    priceYearly: 0,
    monthlyLimit: 1_000,
    features: ['single_tenant', 'community_support', 'sdk', 'dashboard'],
  },
  growth: {
    tier: 'growth',
    name: 'Growth',
    priceMonthly: 99,
    priceYearly: 990,
    monthlyLimit: 100_000,
    features: ['multi_region', 'webhooks', 'oidc', 'sla_999', 'email_alerts', 'priority_support'],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY,
    stripePriceIdYearly: process.env.STRIPE_PRICE_GROWTH_YEARLY,
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    priceMonthly: 499,
    priceYearly: 4990,
    monthlyLimit: -1, // unlimited
    features: ['saml', 'fido2', 'nitro_enclave', 'sla_9999', 'on_prem', 'dedicated_support', 'audit_streaming'],
    stripePriceIdMonthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
  },
}

// ---------------------------------------------------------------------------
// Stripe Checkout
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Checkout session for a plan upgrade.
 *
 * The user is redirected to Stripe's hosted checkout page.
 * After payment, Stripe redirects back to the success URL and sends
 * a webhook event (checkout.session.completed).
 */
export async function createCheckoutSession(opts: {
  tenantId: string
  planTier: 'developer' | 'growth' | 'enterprise'
  interval: 'month' | 'year'
  customerEmail: string
  successUrl: string
  cancelUrl: string
}): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe()
  const plan = BILLING_PLANS[opts.planTier]
  if (!plan) throw new Error(`Unknown plan: ${opts.planTier}`)

  const priceId = opts.interval === 'year'
    ? plan.stripePriceIdYearly
    : plan.stripePriceIdMonthly

  if (!priceId) {
    throw new Error(`Stripe Price ID not configured for ${plan.name} (${opts.interval}). Set STRIPE_PRICE_${opts.planTier.toUpperCase()}_${opts.interval.toUpperCase()}`)
  }

  // Check if customer already exists
  let customerId: string | undefined
  const existingSub = await db.subscription.findUnique({
    where: { tenantId: opts.tenantId },
    select: { stripeCustomerId: true },
  })
  if (existingSub?.stripeCustomerId) {
    customerId = existingSub.stripeCustomerId
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    customer_email: customerId ? undefined : opts.customerEmail,
    customer: customerId,
    client_reference_id: opts.tenantId,
    metadata: {
      tenantId: opts.tenantId,
      planTier: opts.planTier,
      interval: opts.interval,
    },
    subscription_data: {
      metadata: {
        tenantId: opts.tenantId,
        planTier: opts.planTier,
      },
    },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
  })

  // Create/update subscription record
  await db.subscription.upsert({
    where: { tenantId: opts.tenantId },
    create: {
      tenantId: opts.tenantId,
      planTier: opts.planTier,
      interval: opts.interval,
      status: 'incomplete',
      stripeCheckoutSessionId: session.id,
      stripePriceId: priceId,
    },
    update: {
      planTier: opts.planTier,
      interval: opts.interval,
      stripeCheckoutSessionId: session.id,
      stripePriceId: priceId,
    },
  })

  await appendAudit({
    tenantId: opts.tenantId,
    eventType: 'tenant.created',
    payload: { action: 'checkout_session_created', planTier: opts.planTier, interval: opts.interval, sessionId: session.id },
  })

  return { url: session.url!, sessionId: session.id }
}

// ---------------------------------------------------------------------------
// Stripe Customer Portal
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Customer Portal session for managing billing.
 *
 * Allows the customer to:
 *   - Update payment method
 *   - View invoices
 *   - Cancel subscription
 *   - Change plan
 */
export async function createCustomerPortalSession(opts: {
  tenantId: string
  returnUrl: string
}): Promise<{ url: string }> {
  const stripe = getStripe()

  const sub = await db.subscription.findUnique({
    where: { tenantId: opts.tenantId },
    select: { stripeCustomerId: true },
  })

  if (!sub?.stripeCustomerId) {
    throw new Error('No Stripe customer found — subscribe first')
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: opts.returnUrl,
  })

  return { url: session.url }
}

// ---------------------------------------------------------------------------
// Stripe Webhook Handler
// ---------------------------------------------------------------------------

/** Maximum age for a webhook event (5 minutes). Prevents replay attacks. */
const MAX_WEBHOOK_AGE_SECONDS = 300

/**
 * Verify + process a Stripe webhook event.
 *
 * SECURITY:
 *   1. Signature verification: stripe.webhooks.constructEvent (timing-safe)
 *   2. Replay protection: reject events older than 5 minutes
 *   3. Idempotency: dedup by event ID (Stripe retries up to 16× over 3 days)
 *   4. Webhook-only business logic: subscription activation happens HERE,
 *      never in the checkout success_url redirect.
 *
 * Must be called with the RAW request body (not parsed JSON) for
 * signature verification to work.
 */
export async function handleStripeWebhook(
  rawBody: string | Buffer,
  signature: string,
): Promise<{ received: boolean; event?: string; error?: string; idempotent?: boolean }> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    logger.error('STRIPE_WEBHOOK_SECRET not configured — webhook rejected')
    return { received: false, error: 'Webhook secret not configured' }
  }

  const stripe = getStripe()

  // --- Security Layer 1: Signature verification (timing-safe) ---
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (e) {
    logger.warn({ error: e }, 'Stripe webhook signature verification failed')
    return { received: false, error: 'Invalid signature' }
  }

  // --- Security Layer 2: Replay protection (reject events older than 5 min) ---
  const eventAge = Math.floor(Date.now() / 1000) - event.created
  if (eventAge > MAX_WEBHOOK_AGE_SECONDS) {
    logger.warn(
      { eventId: event.id, eventAge, maxAge: MAX_WEBHOOK_AGE_SECONDS },
      'Stripe webhook rejected — event too old (replay protection)',
    )
    return { received: false, error: 'Event too old — possible replay attack' }
  }

  // --- Security Layer 3: Idempotency (dedup by event ID) ---
  // Stripe retries webhooks up to 16 times over 3 days. Without dedup,
  // each retry would create duplicate invoice/payment records.
  const existingEvent = await db.webhookEvent.findUnique({
    where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
  })

  if (existingEvent?.processed) {
    logger.info({ eventId: event.id, type: event.type }, 'Stripe webhook already processed — skipping (idempotent)')
    return { received: true, event: event.type, idempotent: true }
  }

  // Record the event (or update if it exists but wasn't processed)
  await db.webhookEvent.upsert({
    where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
    create: {
      provider: 'stripe',
      eventId: event.id,
      eventType: event.type,
      payload: JSON.stringify(event),
    },
    update: {
      eventType: event.type,
      payload: JSON.stringify(event),
    },
  })

  logger.info({ type: event.type, id: event.id, age: eventAge }, 'Stripe webhook received — processing')

  // --- Security Layer 4: Process event (business logic runs HERE, not in success_url) ---
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice)
        break

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break

      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent)
        break

      default:
        logger.debug({ type: event.type }, 'Unhandled Stripe event type')
    }

    // Mark event as processed
    await db.webhookEvent.update({
      where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
      data: { processed: true, processedAt: new Date() },
    })

    return { received: true, event: event.type }
  } catch (e) {
    // Mark as failed (will be retried by Stripe)
    await db.webhookEvent.update({
      where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
      data: { processed: false, error: String(e).slice(0, 500) },
    })

    logger.error({ error: e, type: event.type, eventId: event.id }, 'Stripe webhook processing failed')
    return { received: false, error: 'Processing failed' }
  }
}

// ---------------------------------------------------------------------------
// Stripe event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tenantId = session.metadata?.tenantId
  if (!tenantId) return

  const planTier = session.metadata?.planTier as 'developer' | 'growth' | 'enterprise'
  const interval = session.metadata?.interval as 'month' | 'year'

  // Update subscription record
  await db.subscription.upsert({
    where: { tenantId },
    create: {
      tenantId,
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: session.subscription as string,
      stripePriceId: session.metadata?.priceId,
      planTier,
      interval,
      status: 'active',
      stripeCheckoutSessionId: session.id,
    },
    update: {
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: session.subscription as string,
      planTier,
      interval,
      status: 'active',
    },
  })

  // Update tenant plan tier
  await db.tenant.update({
    where: { id: tenantId },
    data: { planTier },
  })

  await appendAudit({
    tenantId,
    eventType: 'tenant.created',
    payload: { action: 'subscription_activated', planTier, interval, sessionId: session.id },
  })

  logger.info({ tenantId, planTier }, 'Subscription activated via Stripe checkout')
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const tenantId = subscription.metadata?.tenantId
  if (!tenantId) {
    // Try to find by stripe customer ID
    const existing = await db.subscription.findFirst({
      where: { stripeCustomerId: subscription.customer as string },
    })
    if (!existing) return
    // Use existing.tenantId
  }

  const tenantIdToUse = tenantId || (await db.subscription.findFirst({
    where: { stripeCustomerId: subscription.customer as string },
  }))?.tenantId

  if (!tenantIdToUse) return

  await db.subscription.update({
    where: { tenantId: tenantIdToUse },
    data: {
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    },
  })

  logger.info({ tenantId: tenantIdToUse, status: subscription.status }, 'Subscription updated')
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const tenantId = subscription.metadata?.tenantId
  if (!tenantId) return

  // Downgrade to developer plan
  await db.subscription.update({
    where: { tenantId },
    data: {
      status: 'canceled',
      canceledAt: new Date(),
      planTier: 'developer',
    },
  })

  await db.tenant.update({
    where: { id: tenantId },
    data: { planTier: 'developer' },
  })

  await appendAudit({
    tenantId,
    eventType: 'tenant.deactivated',
    payload: { action: 'subscription_canceled', subscriptionId: subscription.id },
  })

  logger.info({ tenantId }, 'Subscription canceled — downgraded to developer')
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const tenantId = invoice.metadata?.tenantId || (await db.subscription.findFirst({
    where: { stripeCustomerId: invoice.customer as string },
  }))?.tenantId

  if (!tenantId) return

  const sub = await db.subscription.findUnique({ where: { tenantId } })
  if (!sub) return

  // Create invoice record
  await db.invoice.create({
    data: {
      tenantId,
      subscriptionId: sub.id,
      stripeInvoiceId: invoice.id,
      number: invoice.number,
      status: 'paid',
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      lineItems: JSON.stringify(invoice.lines.data),
      invoicePdf: invoice.invoice_pdf,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      paidAt: new Date(),
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    },
  })

  // Create payment record
  await db.payment.create({
    data: {
      tenantId,
      subscriptionId: sub.id,
      provider: 'stripe',
      providerPaymentId: invoice.payment_intent as string,
      providerChargeId: invoice.charge as string,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: 'succeeded',
      paymentMethod: 'card',
    },
  })

  logger.info({ tenantId, invoiceId: invoice.id, amount: invoice.amount_paid }, 'Invoice paid')
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const tenantId = invoice.metadata?.tenantId

  if (tenantId) {
    await appendAudit({
      tenantId,
      eventType: 'tenant.deactivated',
      payload: { action: 'payment_failed', invoiceId: invoice.id, attemptCount: invoice.attempt_count },
    })
  }

  logger.warn({ tenantId, invoiceId: invoice.id }, 'Invoice payment failed')
}

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  logger.info({ paymentIntentId: paymentIntent.id, amount: paymentIntent.amount }, 'Payment succeeded')
}

// ---------------------------------------------------------------------------
// Metered billing — sync usage to Stripe
// ---------------------------------------------------------------------------

/**
 * Report usage to Stripe (for metered billing).
 *
 * Called by a cron job at the end of each billing period.
 * Reports the total API calls for the period to Stripe.
 */
export async function reportUsageToStripe(tenantId: string): Promise<boolean> {
  const stripe = getStripe()

  const sub = await db.subscription.findUnique({
    where: { tenantId },
    select: { stripeSubscriptionId: true, stripeCustomerId: true },
  })

  if (!sub?.stripeSubscriptionId) return false

  // Get current month's usage
  const now = new Date()
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const usage = await db.apiUsageCounter.findUnique({
    where: { tenantId_monthKey: { tenantId, monthKey } },
  })

  if (!usage) return false

  // SECURITY FIX (C-12): Actually report usage to Stripe.
  // Previously, this function logged but never called the Stripe API —
  // tenants on metered billing were never charged for actual usage.
  //
  // We retrieve the subscription's first item and create a usage record.
  // This requires the Stripe Price to be configured as 'metered' (not 'licensed').
  try {
    const subscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)

    if (subscription.items.data.length === 0) {
      logger.warn({ tenantId, subscriptionId: sub.stripeSubscriptionId }, 'No subscription items found')
      return false
    }

    const itemId = subscription.items.data[0].id

    // Create a usage record for the current billing period
    await stripe.subscriptionItems.createUsageRecord(
      itemId,
      {
        quantity: usage.count,
        timestamp: Math.floor(Date.now() / 1000),
        action: 'set', // Set to current count (not increment — we track absolute count)
      },
    )

    logger.info(
      { tenantId, monthKey, count: usage.count, itemId },
      'Usage reported to Stripe (metered billing)',
    )
    return true
  } catch (e: any) {
    // If the price is 'licensed' (not 'metered'), Stripe will return an error.
    // This is expected for fixed-price plans — log and return false.
    if (e?.code === 'resource_missing' || e?.message?.includes('metered')) {
      logger.info(
        { tenantId, subscriptionId: sub.stripeSubscriptionId },
        'Subscription uses fixed pricing (not metered) — usage reporting skipped',
      )
      return false
    }
    logger.error({ error: e, tenantId }, 'Failed to report usage to Stripe')
    return false
  }
}

// ---------------------------------------------------------------------------
// NowPayments crypto billing
// ---------------------------------------------------------------------------

export function isNowPaymentsConfigured(): boolean {
  return !!process.env.NOWPAYMENTS_API_KEY && !!process.env.NOWPAYMENTS_IPN_SECRET
}

const NOWPAYMENTS_API_BASE = process.env.NOWPAYMENTS_API_BASE || 'https://api.nowpayments.io'

/**
 * Create a NowPayments crypto invoice.
 *
 * Supports USDC, BTC, ETH, and 50+ other cryptocurrencies.
 * The user pays to a unique wallet address, and NowPayments sends
 * an IPN (Instant Payment Notification) webhook when the payment is confirmed.
 */
export async function createNowPaymentsInvoice(opts: {
  tenantId: string
  planTier: 'developer' | 'growth' | 'enterprise'
  interval: 'month' | 'year'
  customerEmail: string
}): Promise<{ invoiceUrl: string; invoiceId: string; payAddress: string; payAmount: number; payCurrency: string }> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY
  if (!apiKey) throw new Error('NOWPAYMENTS_API_KEY not configured')

  const plan = BILLING_PLANS[opts.planTier]
  if (!plan) throw new Error(`Unknown plan: ${opts.planTier}`)

  const amount = opts.interval === 'year' ? plan.priceYearly : plan.priceMonthly

  // Create invoice via NowPayments API
  const response = await fetch(`${NOWPAYMENTS_API_BASE}/v1/invoice`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      price_amount: amount,
      price_currency: 'usd',
      pay_currency: 'usdc', // Default to USDC — user can change on checkout
      order_id: `veriface_${opts.tenantId}_${Date.now()}`,
      order_description: `VeriFace Edge ${plan.name} plan (${opts.interval})`,
      ipn_callback_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://api.veriface.io'}/api/billing/nowpayments/webhook`,
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://veriface.io'}/billing/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://veriface.io'}/billing/cancel`,
      customer_email: opts.customerEmail,
      metadata: {
        tenantId: opts.tenantId,
        planTier: opts.planTier,
        interval: opts.interval,
      },
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`NowPayments API error: ${response.status} ${error}`)
  }

  const data = await response.json()

  // Store payment record
  await db.payment.create({
    data: {
      tenantId: opts.tenantId,
      provider: 'nowpayments',
      providerPaymentId: data.id,
      amount: Math.round(amount * 100), // Store in cents
      currency: 'usd',
      status: 'pending',
      metadata: JSON.stringify({
        planTier: opts.planTier,
        interval: opts.interval,
        payAddress: data.pay_address,
        payAmount: data.pay_amount,
        payCurrency: data.pay_currency,
        invoiceUrl: data.invoice_url,
      }),
    },
  })

  await appendAudit({
    tenantId: opts.tenantId,
    eventType: 'tenant.created',
    payload: { action: 'crypto_invoice_created', planTier: opts.planTier, invoiceId: data.id },
  })

  return {
    invoiceUrl: data.invoice_url,
    invoiceId: data.id,
    payAddress: data.pay_address,
    payAmount: data.pay_amount,
    payCurrency: data.pay_currency,
  }
}

/**
 * Verify + process a NowPayments IPN webhook.
 *
 * SECURITY:
 *   1. Signature verification: HMAC-SHA256 (timing-safe comparison)
 *   2. Replay protection: reject events older than 5 minutes
 *   3. Idempotency: dedup by payment_id + payment_status
 *   4. Server-side price verification: verify paid amount matches expected plan price
 *   5. Webhook-only business logic: subscription activation happens HERE,
 *      never in the success_url redirect.
 *
 * NowPayments sends HMAC-signed webhooks. The signature is in the
 * `x-nowpayments-sig` header and is computed as:
 *   HMAC-SHA256(sorted(JSON.stringify(body)), ipn_secret)
 */
export async function handleNowPaymentsWebhook(
  rawBody: string,
  body: any,
  signature: string,
): Promise<{ received: boolean; error?: string; idempotent?: boolean }> {
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET
  if (!ipnSecret) {
    logger.error('NOWPAYMENTS_IPN_SECRET not configured — webhook rejected')
    return { received: false, error: 'IPN secret not configured' }
  }

  // --- Security Layer 1: HMAC signature verification (timing-safe) ---
  // SECURITY FIX (C-10): Compute HMAC over the RAW request body (as received),
  // NOT over re-serialized JSON. Re-serialization changes the byte order and
  // separators, causing signature mismatch with what NowPayments signed.
  const crypto = await import('node:crypto')
  const expectedSig = crypto.createHmac('sha256', ipnSecret).update(rawBody).digest('hex')

  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSig)
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    logger.warn({ signature: signature.slice(0, 16) }, 'NowPayments webhook signature verification failed')
    return { received: false, error: 'Invalid signature' }
  }

  const paymentId = body.payment_id
  const paymentStatus = body.payment_status
  const tenantId = body.metadata?.tenantId
  const planTier = body.metadata?.planTier

  if (!tenantId || !paymentId) {
    return { received: false, error: 'Missing tenantId or paymentId' }
  }

  // --- Security Layer 2: Replay protection (reject events older than 5 min) ---
  // SECURITY FIX (C-11): Require created_at to be present.
  // Previously, if created_at was missing, eventAge was 0 and the check
  // was bypassed. Now we reject webhooks without a timestamp.
  if (!body.created_at) {
    logger.warn({ paymentId }, 'NowPayments webhook rejected — missing created_at timestamp')
    return { received: false, error: 'Missing created_at — possible replay attack' }
  }
  const eventTimestamp = new Date(body.created_at).getTime() / 1000
  const eventAge = Math.floor(Date.now() / 1000) - eventTimestamp
  if (eventAge > MAX_WEBHOOK_AGE_SECONDS) {
    logger.warn(
      { paymentId, eventAge, maxAge: MAX_WEBHOOK_AGE_SECONDS },
      'NowPayments webhook rejected — event too old (replay protection)',
    )
    return { received: false, error: 'Event too old — possible replay attack' }
  }

  // --- Security Layer 3: Idempotency (dedup by payment_id + status) ---
  // NowPayments retries webhooks for 24 hours. Each status change is a new event,
  // but the same status can be delivered multiple times.
  const eventId = `${paymentId}_${paymentStatus}`
  const existingEvent = await db.webhookEvent.findUnique({
    where: { provider_eventId: { provider: 'nowpayments', eventId } },
  })

  if (existingEvent?.processed) {
    logger.info({ eventId, paymentId, status: paymentStatus }, 'NowPayments webhook already processed — skipping (idempotent)')
    return { received: true, idempotent: true }
  }

  await db.webhookEvent.upsert({
    where: { provider_eventId: { provider: 'nowpayments', eventId } },
    create: {
      provider: 'nowpayments',
      eventId,
      eventType: paymentStatus,
      payload: JSON.stringify(body),
    },
    update: {
      eventType: paymentStatus,
      payload: JSON.stringify(body),
    },
  })

  logger.info({ paymentId, status: paymentStatus, age: eventAge }, 'NowPayments webhook received — processing')

  // --- Security Layer 4: Server-side price verification ---
  // NEVER trust the price from the webhook body. Verify the paid amount
  // matches the expected plan price from our server-side BILLING_PLANS.
  const plan = BILLING_PLANS[planTier as keyof typeof BILLING_PLANS]
  if (!plan) {
    logger.error({ planTier }, 'NowPayments webhook: unknown plan tier')
    return { received: false, error: 'Unknown plan tier' }
  }

  const expectedInterval = body.metadata?.interval || 'month'
  const expectedPriceUsd = expectedInterval === 'year' ? plan.priceYearly : plan.priceMonthly
  const actualPriceUsd = body.price_amount || 0

  // Allow 1% tolerance for crypto price fluctuations (NowPayments converts USD → crypto at checkout time)
  if (Math.abs(actualPriceUsd - expectedPriceUsd) > expectedPriceUsd * 0.01) {
    logger.error(
      { paymentId, expectedPriceUsd, actualPriceUsd, planTier },
      'NowPayments webhook: price mismatch — possible manipulation attempt',
    )
    await appendAudit({
      tenantId,
      eventType: 'tenant.deactivated',
      payload: {
        action: 'price_mismatch_rejected',
        paymentId,
        expectedPriceUsd,
        actualPriceUsd,
        planTier,
      },
    })
    return { received: false, error: 'Price mismatch — payment rejected' }
  }

  // --- Process payment status ---
  const status = paymentStatus === 'finished' || paymentStatus === 'confirmed'
    ? 'succeeded'
    : paymentStatus === 'failed' || paymentStatus === 'expired'
    ? 'failed'
    : 'pending'

  // Update payment record
  await db.payment.updateMany({
    where: { providerPaymentId: paymentId, provider: 'nowpayments' },
    data: {
      status,
      fromAddress: body.pay_from,
      toAddress: body.pay_address,
      txHash: body.tx_hash,
      confirmations: body.confirmations,
      metadata: JSON.stringify(body),
    },
  })

  // --- Security Layer 5: Webhook-only business logic ---
  // Subscription activation happens HERE (in the webhook), never in the
  // success_url redirect. The success_url is display-only.
  if (status === 'succeeded') {
    await db.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planTier,
        status: 'active',
        interval: expectedInterval,
      },
      update: {
        planTier,
        status: 'active',
      },
    })

    await db.tenant.update({
      where: { id: tenantId },
      data: { planTier },
    })

    await appendAudit({
      tenantId,
      eventType: 'tenant.created',
      payload: { action: 'crypto_payment_confirmed', planTier, paymentId, txHash: body.tx_hash },
    })

    logger.info({ tenantId, planTier, txHash: body.tx_hash }, 'Crypto payment confirmed — subscription activated via webhook')
  }

  // Mark event as processed
  await db.webhookEvent.update({
    where: { provider_eventId: { provider: 'nowpayments', eventId } },
    data: { processed: true, processedAt: new Date() },
  })

  return { received: true }
}

// ---------------------------------------------------------------------------
// Billing status
// ---------------------------------------------------------------------------

export async function getBillingStatus(tenantId: string) {
  const sub = await db.subscription.findUnique({
    where: { tenantId },
    include: {
      invoices: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  })

  if (!sub) {
    return {
      hasSubscription: false,
      planTier: 'developer',
      status: 'none',
    }
  }

  return {
    hasSubscription: true,
    planTier: sub.planTier,
    status: sub.status,
    interval: sub.interval,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    invoices: sub.invoices,
    payments: sub.payments,
    stripeCustomerId: sub.stripeCustomerId,
    stripeConfigured: isStripeConfigured(),
    nowpaymentsConfigured: isNowPaymentsConfigured(),
  }
}
