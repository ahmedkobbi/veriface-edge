/**
 * VeriFace Edge — Email Notification System
 *
 * Sends transactional + alert emails via a queue with retry/backoff:
 *   - Auth alerts: new device login, failed login attempts, password/2FA changes
 *   - Billing alerts: usage threshold (80%), monthly limit reached, spending alert
 *   - Security alerts: injection detected, API key create/revoke
 *
 * Architecture:
 *   1. Trigger event (e.g., login) calls `enqueueEmail(...)`
 *   2. Email is written to `EmailLog` with state='pending'
 *   3. Worker (inline on enqueue OR cron /api/notifications/process-queue) sends via provider
 *   4. On failure, schedules retry with exponential backoff (1m, 10m, 1h)
 *   5. After maxAttempts, dead-letters (state='failed')
 *
 * Deduplication: when `dedupKey` is set, only one email per
 *   (tenantId, template, dedupKey) within a 10-min window is enqueued.
 *   This prevents email flooding during brute-force attacks.
 *
 * Idempotency: idempotencyKey = SHA-256(tenantId | template | dedupKey | windowStart)
 *   Enforced by @@unique constraint — duplicate enqueues are silently ignored.
 *
 * Providers (auto-detected by env vars):
 *   - SMTP (Nodemailer) — SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   - AWS SES — AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
 *   - Resend — RESEND_API_KEY + RESEND_FROM
 *   - Console (dev fallback) — no SMTP configured
 *
 * Preferences: each platform user has a `NotificationPreference` record.
 *   If the user has disabled the relevant category, the email is suppressed
 *   (state='suppressed') and not sent — but still logged for audit.
 */

import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'
import { sendEmail } from '@/lib/email'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmailTemplate =
  | 'auth.new_device'
  | 'auth.failed_login'
  | 'auth.password_changed'
  | 'auth.two_factor_enabled'
  | 'auth.two_factor_disabled'
  | 'billing.threshold'
  | 'billing.limit_reached'
  | 'billing.spending_alert'
  | 'security.api_key_created'
  | 'security.api_key_revoked'
  | 'security.injection_detected'
  | 'security.suspicious_activity'
  | 'system.welcome'
  | 'system.email_verification'
  | 'system.password_reset'

export type NotificationCategory = 'auth' | 'security' | 'billing' | 'product'

export const TEMPLATE_TO_CATEGORY: Record<EmailTemplate, NotificationCategory> = {
  'auth.new_device': 'auth',
  'auth.failed_login': 'auth',
  'auth.password_changed': 'auth',
  'auth.two_factor_enabled': 'auth',
  'auth.two_factor_disabled': 'auth',
  'billing.threshold': 'billing',
  'billing.limit_reached': 'billing',
  'billing.spending_alert': 'billing',
  'security.api_key_created': 'security',
  'security.api_key_revoked': 'security',
  'security.injection_detected': 'security',
  'security.suspicious_activity': 'security',
  'system.welcome': 'product',
  'system.email_verification': 'auth',
  'system.password_reset': 'auth',
}

export interface EmailRenderResult {
  subject: string
  html: string
  text: string
}

export interface EnqueueEmailInput {
  tenantId: string
  /** Recipient email. */
  to: string
  /** PlatformUser ID (for preferences lookup). If null, no preference check. */
  userId?: string
  template: EmailTemplate
  /** Template variables (passed to renderer). */
  vars?: Record<string, string | number | undefined>
  /**
   * Dedup key. When set, only one email per (tenantId, template, dedupKey)
   * within a 10-min window will be enqueued. Use for high-volume events
   * like failed logins to prevent flooding.
   */
  dedupKey?: string
  /** Skip preference check (e.g., for transactional password reset). */
  bypassPreferences?: boolean
}

// ---------------------------------------------------------------------------
// Queue entry
// ---------------------------------------------------------------------------

const DEDUP_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

function getIdempotencyKey(
  tenantId: string,
  template: EmailTemplate,
  dedupKey: string | undefined,
): string {
  const now = Date.now()
  const windowStart = dedupKey ? Math.floor(now / DEDUP_WINDOW_MS) : now
  return sha256Hex(`${tenantId}|${template}|${dedupKey ?? ''}|${windowStart}`)
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

interface Prefs {
  authAlerts: boolean
  securityAlerts: boolean
  billingAlerts: boolean
  productUpdates: boolean
  weeklyDigest: boolean
}

const DEFAULT_PREFS: Prefs = {
  authAlerts: true,
  securityAlerts: true,
  billingAlerts: true,
  productUpdates: false,
  weeklyDigest: true,
}

export async function getUserPreferences(userId: string): Promise<Prefs> {
  const prefs = await db.notificationPreference.findUnique({ where: { userId } })
  if (!prefs) return DEFAULT_PREFS
  return {
    authAlerts: prefs.authAlerts,
    securityAlerts: prefs.securityAlerts,
    billingAlerts: prefs.billingAlerts,
    productUpdates: prefs.productUpdates,
    weeklyDigest: prefs.weeklyDigest,
  }
}

export async function setUserPreferences(userId: string, tenantId: string, patch: Partial<Prefs>): Promise<Prefs> {
  const current = await getUserPreferences(userId)
  const updated = { ...current, ...patch }
  await db.notificationPreference.upsert({
    where: { userId },
    create: { userId, tenantId, ...updated },
    update: updated,
  })
  return updated
}

function isCategoryEnabled(prefs: Prefs, category: NotificationCategory): boolean {
  switch (category) {
    case 'auth': return prefs.authAlerts
    case 'security': return prefs.securityAlerts
    case 'billing': return prefs.billingAlerts
    case 'product': return prefs.productUpdates
    default: return true
  }
}

// ---------------------------------------------------------------------------
// Email enqueue
// ---------------------------------------------------------------------------

export interface EnqueueResult {
  enqueued: boolean
  emailId?: string
  reason?: 'duplicate' | 'preference_disabled' | 'enqueued'
}

/**
 * Enqueue an email for sending. Writes to EmailLog with state='pending'.
 * The actual send happens either:
 *   - Inline (immediately) for low-volume transactional emails, OR
 *   - Deferred to the /api/notifications/process-queue cron (every 5 min)
 *
 * Dedup: if (tenantId, template, dedupKey) was already enqueued within the
 * last 10 minutes, the new request is silently ignored.
 *
 * Preferences: if the recipient has disabled the relevant category, the
 * email is logged with state='suppressed' (for audit) but not sent.
 */
export async function enqueueEmail(input: EnqueueEmailInput): Promise<EnqueueResult> {
  const category = TEMPLATE_TO_CATEGORY[input.template]

  // 1. Check preferences
  if (!input.bypassPreferences && input.userId) {
    const prefs = await getUserPreferences(input.userId)
    if (!isCategoryEnabled(prefs, category)) {
      // Log as suppressed (audit trail) — but don't actually send
      const rendered = renderTemplate(input.template, input.vars ?? {})
      const idempotencyKey = getIdempotencyKey(input.tenantId, input.template, input.dedupKey)
      try {
        await db.emailLog.create({
          data: {
            tenantId: input.tenantId,
            toAddress: input.to,
            template: input.template,
            subject: rendered.subject,
            bodyHtml: rendered.html,
            state: 'suppressed',
            dedupKey: input.dedupKey,
            idempotencyKey,
            sentAt: new Date(),
          },
        })
      } catch {
        // Idempotency conflict — duplicate, ignore silently
      }
      return { enqueued: false, reason: 'preference_disabled' }
    }
  }

  // 2. Compute idempotency key (handles dedup)
  const idempotencyKey = getIdempotencyKey(input.tenantId, input.template, input.dedupKey)

  // 3. Render template
  const rendered = renderTemplate(input.template, input.vars ?? {})

  // 4. Insert (idempotency enforced by @@unique)
  try {
    const entry = await db.emailLog.create({
      data: {
        tenantId: input.tenantId,
        toAddress: input.to,
        template: input.template,
        subject: rendered.subject,
        bodyHtml: rendered.html,
        state: 'pending',
        dedupKey: input.dedupKey,
        idempotencyKey,
        nextRetryAt: new Date(), // eligible immediately
      },
    })

    // 5. Inline-send attempt (best-effort; failures go to cron retry)
    // We don't await this for high-frequency events (failed_login) to avoid
    // blocking the request. For low-frequency events (welcome, password_reset),
    // we await to ensure delivery before responding to the user.
    const isHighFreq = input.template === 'auth.failed_login' || input.template === 'security.injection_detected'
    if (isHighFreq) {
      void processEmailEntry(entry.id).catch((e) => {
        logger.warn({ error: e, emailId: entry.id }, 'Inline email send failed (will retry)')
      })
    } else {
      await processEmailEntry(entry.id)
    }

    return { enqueued: true, emailId: entry.id, reason: 'enqueued' }
  } catch (e: any) {
    // P2002 = unique constraint violation = duplicate within window
    if (e?.code === 'P2002') {
      return { enqueued: false, reason: 'duplicate' }
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// Email send (single entry)
// ---------------------------------------------------------------------------

const BACKOFF_SCHEDULE_MS = [60_000, 600_000, 3_600_000] // 1m, 10m, 1h

/**
 * Process a single email log entry: try to send via provider, on success
 * mark 'sent', on failure schedule retry or dead-letter.
 */
export async function processEmailEntry(emailId: string): Promise<{
  sent: boolean
  state: string
  attempts: number
  error?: string
}> {
  const entry = await db.emailLog.findUnique({ where: { id: emailId } })
  if (!entry) return { sent: false, state: 'missing', attempts: 0 }
  if (entry.state === 'sent' || entry.state === 'suppressed') {
    return { sent: entry.state === 'sent', state: entry.state, attempts: entry.attempts }
  }

  const attempts = entry.attempts + 1
  try {
    const ok = await sendEmail({
      to: entry.toAddress,
      subject: entry.subject,
      html: entry.bodyHtml,
      text: entry.bodyHtml.replace(/<[^>]*>/g, ''),
    })

    if (!ok) {
      throw new Error('Provider returned false')
    }

    await db.emailLog.update({
      where: { id: emailId },
      data: {
        state: 'sent',
        attempts,
        sentAt: new Date(),
        nextRetryAt: null,
        lastError: null,
      },
    })

    logger.info({ emailId, template: entry.template, attempts }, 'Email sent')
    return { sent: true, state: 'sent', attempts }
  } catch (e: any) {
    const errorMsg = String(e?.message ?? e).slice(0, 500)
    const willRetry = attempts < entry.maxAttempts
    const nextRetryAt = willRetry
      ? new Date(Date.now() + (BACKOFF_SCHEDULE_MS[attempts - 1] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]))
      : null

    await db.emailLog.update({
      where: { id: emailId },
      data: {
        state: willRetry ? 'pending' : 'failed',
        attempts,
        nextRetryAt,
        lastError: errorMsg,
      },
    })

    logger.warn({ emailId, attempts, error: errorMsg, willRetry }, 'Email send failed')
    return { sent: false, state: willRetry ? 'pending' : 'failed', attempts, error: errorMsg }
  }
}

/**
 * Process the entire pending queue (called by cron endpoint).
 * Picks up entries where nextRetryAt <= now AND state = 'pending',
 * processes up to BATCH_SIZE per invocation.
 */
export async function processPendingQueue(batchSize = 50): Promise<{
  processed: number
  sent: number
  failed: number
  retried: number
}> {
  const now = new Date()
  const pending = await db.emailLog.findMany({
    where: {
      state: 'pending',
      nextRetryAt: { lte: now },
    },
    orderBy: { nextRetryAt: 'asc' },
    take: batchSize,
    select: { id: true },
  })

  let sent = 0
  let failed = 0
  let retried = 0

  for (const entry of pending) {
    const result = await processEmailEntry(entry.id)
    if (result.sent) sent++
    else if (result.state === 'failed') failed++
    else retried++
  }

  return { processed: pending.length, sent, failed, retried }
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

function renderTemplate(template: EmailTemplate, vars: Record<string, string | number | undefined>): EmailRenderResult {
  switch (template) {
    case 'auth.new_device':
      return renderNewDevice(vars)
    case 'auth.failed_login':
      return renderFailedLogin(vars)
    case 'auth.password_changed':
      return renderPasswordChanged(vars)
    case 'auth.two_factor_enabled':
      return renderTwoFactorChanged(vars, true)
    case 'auth.two_factor_disabled':
      return renderTwoFactorChanged(vars, false)
    case 'billing.threshold':
      return renderBillingThreshold(vars)
    case 'billing.limit_reached':
      return renderBillingLimitReached(vars)
    case 'billing.spending_alert':
      return renderSpendingAlert(vars)
    case 'security.api_key_created':
      return renderApiKeyChanged(vars, true)
    case 'security.api_key_revoked':
      return renderApiKeyChanged(vars, false)
    case 'security.injection_detected':
      return renderInjectionDetected(vars)
    case 'security.suspicious_activity':
      return renderSuspiciousActivity(vars)
    case 'system.welcome':
      return renderWelcome(vars)
    case 'system.email_verification':
      return renderEmailVerification(vars)
    case 'system.password_reset':
      return renderPasswordReset(vars)
    default:
      throw new Error(`Unknown email template: ${template}`)
  }
}

// ---------------------------------------------------------------------------
// Template implementations
// ---------------------------------------------------------------------------

const BRAND_HEADER = `
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#10b981;font-size:24px;margin:0;letter-spacing:-0.5px;">VeriFace Edge</h1>
    <p style="color:#64748b;font-size:12px;margin:4px 0 0;">Privacy-First Facial Authentication</p>
  </div>
`

const BRAND_FOOTER = `
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
  <p style="color:#94a3b8;font-size:11px;text-align:center;line-height:1.6;">
    © 2026 VeriFace Edge · <a href="https://veriface.io/security" style="color:#64748b;">Security Center</a> · <a href="https://veriface.io/privacy" style="color:#64748b;">Privacy Policy</a><br>
    You received this email because of your VeriFace Edge account notification preferences.
  </p>
`

const CONTAINER_OPEN = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b;">`
const CONTAINER_CLOSE = `${BRAND_FOOTER}</div>`

function truncate(s: string | undefined, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function renderNewDevice(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const ip = vars.ip ?? 'unknown'
  const location = vars.location ?? 'Unknown location'
  const device = truncate(vars.device as string, 80) || 'Unknown device'
  const timestamp = vars.timestamp ?? new Date().toISOString()
  const subject = 'New device signed in to your VeriFace Edge account'
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:#1e293b;font-size:18px;">New sign-in detected</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      We noticed a new sign-in to your VeriFace Edge account. If this was you, no action is needed.
      If you don't recognize this activity, please change your password immediately and contact support.
    </p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:20px 0;font-size:13px;line-height:1.8;">
      <strong style="color:#1e293b;">IP address:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:3px;">${ip}</code><br>
      <strong style="color:#1e293b;">Location:</strong> ${location}<br>
      <strong style="color:#1e293b;">Device:</strong> ${device}<br>
      <strong style="color:#1e293b;">Time:</strong> ${timestamp}
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      If this wasn't you, your account may be compromised. We recommend:
    </p>
    <ul style="color:#475569;font-size:14px;line-height:1.8;padding-left:20px;">
      <li>Change your password immediately</li>
      <li>Enable two-factor authentication (if not already)</li>
      <li>Review your active sessions in the customer portal</li>
    </ul>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `New sign-in from ${ip} at ${timestamp}. If this wasn't you, change your password immediately.` }
}

function renderFailedLogin(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const attempts = vars.attempts ?? 5
  const window = vars.window ?? '10 minutes'
  const ip = vars.ip ?? 'unknown'
  const subject = `⚠️ ${attempts} failed sign-in attempts on your account`
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;margin:16px 0;border-radius:4px;">
      <h2 style="color:#991b1b;font-size:16px;margin:0 0 4px;">⚠️ Multiple failed login attempts</h2>
      <p style="color:#7f1d1d;font-size:13px;margin:0;">Possible brute-force attack detected</p>
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      We detected <strong>${attempts} failed sign-in attempts</strong> on your VeriFace Edge account
      within the last <strong>${window}</strong>. All attempts originated from IP
      <code style="background:#e2e8f0;padding:2px 6px;border-radius:3px;">${ip}</code>.
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Your account is protected — none of these attempts succeeded. As a precaution:
    </p>
    <ul style="color:#475569;font-size:14px;line-height:1.8;padding-left:20px;">
      <li>If you don't recognize this activity, change your password immediately</li>
      <li>Enable two-factor authentication for additional protection</li>
      <li>If these were your own attempts, you can safely ignore this email</li>
    </ul>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `${attempts} failed login attempts from ${ip} in ${window}. Change your password if this wasn't you.` }
}

function renderPasswordChanged(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const timestamp = vars.timestamp ?? new Date().toISOString()
  const ip = vars.ip ?? 'unknown'
  const subject = 'Your VeriFace Edge password was changed'
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:#1e293b;font-size:18px;">Password changed successfully</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      Your VeriFace Edge account password was changed on <strong>${timestamp}</strong> from IP
      <code style="background:#e2e8f0;padding:2px 6px;border-radius:3px;">${ip}</code>.
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      If you made this change, no further action is needed. If you did NOT change your password,
      your account may be compromised — please:
    </p>
    <ul style="color:#475569;font-size:14px;line-height:1.8;padding-left:20px;">
      <li>Reset your password immediately using the "Forgot password" link</li>
      <li>Review your account activity in the customer portal</li>
      <li>Contact support if you need help securing your account</li>
    </ul>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `Your password was changed on ${timestamp} from ${ip}. If this wasn't you, reset it immediately.` }
}

function renderTwoFactorChanged(vars: Record<string, string | number | undefined>, enabled: boolean): EmailRenderResult {
  const name = vars.name ?? 'there'
  const timestamp = vars.timestamp ?? new Date().toISOString()
  const action = enabled ? 'enabled' : 'disabled'
  const color = enabled ? '#10b981' : '#ef4444'
  const icon = enabled ? '✅' : '⚠️'
  const subject = `${icon} Two-factor authentication ${action}`
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:${color};font-size:18px;">${icon} 2FA ${action}</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      Two-factor authentication was <strong>${action}</strong> on your VeriFace Edge account
      on <strong>${timestamp}</strong>.
    </p>
    ${!enabled ? `
      <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;margin:16px 0;border-radius:4px;">
        <p style="color:#7f1d1d;font-size:13px;margin:0;">
          <strong>Security warning:</strong> Your account is now less protected.
          We strongly recommend re-enabling 2FA from your security settings.
        </p>
      </div>
    ` : ''}
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      If this wasn't you, please contact support immediately.
    </p>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `2FA was ${action} on ${timestamp}. If this wasn't you, contact support immediately.` }
}

function renderBillingThreshold(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const usedPct = vars.usedPct ?? 80
  const currentCount = vars.currentCount ?? 0
  const monthlyLimit = vars.monthlyLimit ?? 1000
  const plan = vars.plan ?? 'Developer'
  const subject = `📊 You've used ${usedPct}% of your monthly VeriFace Edge quota`
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:#1e293b;font-size:18px;">📊 Usage threshold reached</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      You've used <strong>${usedPct}%</strong> of your monthly API quota on the
      <strong>${plan}</strong> plan.
    </p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:20px 0;font-size:14px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#64748b;">Used this month:</span>
        <strong>${currentCount.toLocaleString()} calls</strong>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#64748b;">Monthly limit:</span>
        <strong>${monthlyLimit === -1 ? 'Unlimited' : Number(monthlyLimit).toLocaleString() + ' calls'}</strong>
      </div>
      <div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;margin-top:8px;">
        <div style="background:linear-gradient(90deg,#10b981,#06b6d4);height:100%;width:${usedPct}%;"></div>
      </div>
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      ${plan === 'Developer'
        ? 'When you hit your monthly limit, API calls will be rejected with HTTP 429 until next month. Upgrade to the Growth plan for 100,000 calls/month.'
        : 'You may want to upgrade your plan or set a higher spending limit to avoid hitting the cap.'
      }
    </p>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `${usedPct}% of monthly quota used (${currentCount}/${monthlyLimit}). Consider upgrading.` }
}

function renderBillingLimitReached(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const monthlyLimit = vars.monthlyLimit ?? 1000
  const plan = vars.plan ?? 'Developer'
  const resetDate = vars.resetDate ?? 'next month'
  const subject = `🚫 VeriFace Edge API quota exhausted — requests are being rejected`
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;margin:16px 0;border-radius:4px;">
      <h2 style="color:#991b1b;font-size:16px;margin:0 0 4px;">🚫 Monthly limit reached</h2>
      <p style="color:#7f1d1d;font-size:13px;margin:0;">All API requests now return HTTP 429</p>
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      You've reached your monthly API quota of <strong>${Number(monthlyLimit).toLocaleString()} calls</strong>
      on the <strong>${plan}</strong> plan. API requests are now being rejected with HTTP 429
      until <strong>${resetDate}</strong>.
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      To restore service immediately:
    </p>
    <ul style="color:#475569;font-size:14px;line-height:1.8;padding-left:20px;">
      <li>Upgrade to a higher plan (Growth: 100K/mo, Enterprise: unlimited)</li>
      <li>Wait for the monthly quota to reset</li>
      <li>Contact sales for a custom enterprise quote</li>
    </ul>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `Monthly API quota (${monthlyLimit}) reached. Requests return HTTP 429 until ${resetDate}. Upgrade to restore service.` }
}

function renderSpendingAlert(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const cost = vars.estimatedCost ?? 0
  const limit = vars.spendingLimitUsd ?? 100
  const plan = vars.plan ?? 'Growth'
  const subject = `💸 Spending alert: $${cost} of $${limit} budget used`
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:#1e293b;font-size:18px;">💸 Spending limit alert</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      Your VeriFace Edge spending on the <strong>${plan}</strong> plan has reached
      <strong>$${Number(cost).toFixed(2)}</strong> out of your configured monthly budget
      of <strong>$${Number(limit).toFixed(2)}</strong>.
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      You can adjust your spending limit in the admin panel under <em>Usage & Billing</em>.
      Note: We do not automatically suspend service when the spending limit is reached —
      this is an alert only.
    </p>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `Spending alert: $${cost} of $${limit} budget used.` }
}

function renderApiKeyChanged(vars: Record<string, string | number | undefined>, created: boolean): EmailRenderResult {
  const name = vars.name ?? 'there'
  const label = vars.label ?? 'API key'
  const timestamp = vars.timestamp ?? new Date().toISOString()
  const ip = vars.ip ?? 'unknown'
  const action = created ? 'created' : 'revoked'
  const color = created ? '#10b981' : '#ef4444'
  const subject = `${created ? '🔑 New API key created' : '🚫 API key revoked'} — VeriFace Edge`
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:${color};font-size:18px;">API key ${action}</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      An API key labeled <strong>"${label}"</strong> was <strong>${action}</strong> on your
      VeriFace Edge tenant at <strong>${timestamp}</strong> from IP
      <code style="background:#e2e8f0;padding:2px 6px;border-radius:3px;">${ip}</code>.
    </p>
    ${created ? `
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        If you created this key, no action is needed. The plaintext key was shown only once
        at creation time. If you didn't create this key, please revoke it immediately in the
        developer console and rotate your credentials.
      </p>
    ` : `
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Any existing SDK integrations using this key will now fail with HTTP 401.
        If you didn't revoke this key, please contact support immediately.
      </p>
    `}
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `API key "${label}" was ${action} at ${timestamp} from ${ip}.` }
}

function renderInjectionDetected(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const reasons = (vars.reasons as string) ?? 'injection detected'
  const timestamp = vars.timestamp ?? new Date().toISOString()
  const ip = vars.ip ?? 'unknown'
  const sessionId = vars.sessionId ?? 'unknown'
  const subject = `🛡️ Presentation attack detected — VeriFace Edge`
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;margin:16px 0;border-radius:4px;">
      <h2 style="color:#991b1b;font-size:16px;margin:0 0 4px;">🛡️ Anti-injection system triggered</h2>
      <p style="color:#7f1d1d;font-size:13px;margin:0;">Authentication attempt was blocked</p>
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      VeriFace Edge detected and blocked a presentation attack during an authentication attempt
      on your tenant.
    </p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:20px 0;font-size:13px;line-height:1.8;">
      <strong style="color:#1e293b;">Session ID:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:3px;font-size:11px;">${sessionId}</code><br>
      <strong style="color:#1e293b;">Detection reasons:</strong> ${reasons}<br>
      <strong style="color:#1e293b;">IP:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:3px;">${ip}</code><br>
      <strong style="color:#1e293b;">Time:</strong> ${timestamp}
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      This is informational only — the suspicious attempt was blocked. If you notice a pattern
      of repeated attacks from the same source, consider adding the IP to your access policy
      blocklist in the admin panel.
    </p>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `Presentation attack blocked. Reasons: ${reasons}. IP: ${ip}.` }
}

function renderSuspiciousActivity(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const activity = vars.activity ?? 'suspicious activity detected'
  const timestamp = vars.timestamp ?? new Date().toISOString()
  const subject = `⚠️ Suspicious activity on your VeriFace Edge account`
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:#ef4444;font-size:18px;">⚠️ Suspicious activity detected</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      Our security system detected suspicious activity on your VeriFace Edge tenant:
    </p>
    <div style="background:#fef2f2;border-radius:8px;padding:16px;margin:20px 0;font-size:13px;line-height:1.6;">
      ${activity}
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Time: <strong>${timestamp}</strong><br><br>
      Please review your audit log in the admin panel. If you don't recognize this activity,
      change your password and contact support.
    </p>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `Suspicious activity detected: ${activity}. Review your audit log.` }
}

function renderWelcome(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const apiKey = vars.apiKey ?? 'vf_live_xxx'
  const tenantId = vars.tenantId ?? 'unknown'
  const subject = 'Welcome to VeriFace Edge 🎉'
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:#1e293b;font-size:18px;">Welcome aboard, ${name}! 🎉</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Your VeriFace Edge account is ready. Here's everything you need to get started with
      privacy-first facial authentication:
    </p>
    <div style="background:#0f172a;color:#10b981;border-radius:8px;padding:16px;margin:20px 0;font-family:monospace;font-size:13px;">
      <div style="color:#64748b;font-size:11px;margin-bottom:4px;">TENANT ID</div>
      <div style="color:#e2e8f0;margin-bottom:12px;">${tenantId}</div>
      <div style="color:#64748b;font-size:11px;margin-bottom:4px;">API KEY (keep secret!)</div>
      <div style="color:#10b981;word-break:break-all;">${apiKey}</div>
    </div>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      You're on the <strong>Developer plan</strong> (1,000 API calls/month). Ready to scale?
      Upgrade to <strong>Growth</strong> for 100K calls/month, or contact us about Enterprise.
    </p>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Next steps:
    </p>
    <ul style="color:#475569;font-size:14px;line-height:1.8;padding-left:20px;">
      <li>Install the SDK: <code>npm install @veriface/edge</code></li>
      <li>Read the docs: <a href="https://docs.veriface.io">docs.veriface.io</a></li>
      <li>Try the live demo in your admin panel</li>
    </ul>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `Welcome to VeriFace Edge. Your API key: ${apiKey}. Tenant ID: ${tenantId}.` }
}

function renderEmailVerification(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const link = vars.link ?? 'https://veriface.io'
  const subject = 'Verify your email — VeriFace Edge'
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:#1e293b;font-size:18px;">Verify your email address</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      Please verify your email address to complete your VeriFace Edge account setup.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${link}" style="background:linear-gradient(135deg,#10b981,#06b6d4);color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">
        Verify Email
      </a>
    </div>
    <p style="color:#94a3b8;font-size:12px;line-height:1.5;">
      Or copy this link: ${link}<br><br>
      This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
    </p>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `Verify your email: ${link}` }
}

function renderPasswordReset(vars: Record<string, string | number | undefined>): EmailRenderResult {
  const name = vars.name ?? 'there'
  const link = vars.link ?? 'https://veriface.io'
  const subject = 'Reset your password — VeriFace Edge'
  const html = `${CONTAINER_OPEN}
    ${BRAND_HEADER}
    <h2 style="color:#1e293b;font-size:18px;">Reset your password</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">
      Hi ${name},<br><br>
      We received a request to reset your password. Click the button below to choose a new password:
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${link}" style="background:linear-gradient(135deg,#10b981,#06b6d4);color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block;">
        Reset Password
      </a>
    </div>
    <p style="color:#94a3b8;font-size:12px;line-height:1.5;">
      Or copy this link: ${link}<br><br>
      This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
    </p>
    ${CONTAINER_CLOSE}`
  return { subject, html, text: `Reset your password: ${link}` }
}

// ---------------------------------------------------------------------------
// Convenience triggers (call from event handlers)
// ---------------------------------------------------------------------------

/**
 * Fire billing threshold alert (when usage crosses 80% of monthly limit).
 */
export async function notifyBillingThreshold(opts: {
  tenantId: string
  to: string
  userId?: string
  usedPct: number
  currentCount: number
  monthlyLimit: number
  planName: string
}): Promise<EnqueueResult> {
  return enqueueEmail({
    tenantId: opts.tenantId,
    to: opts.to,
    userId: opts.userId,
    template: 'billing.threshold',
    vars: {
      usedPct: Math.round(opts.usedPct),
      currentCount: opts.currentCount,
      monthlyLimit: opts.monthlyLimit,
      plan: opts.planName,
    },
    dedupKey: `billing_threshold_${opts.tenantId}_${new Date().toISOString().slice(0, 13)}`, // hourly dedup
  })
}

/**
 * Fire monthly limit reached alert.
 */
export async function notifyBillingLimitReached(opts: {
  tenantId: string
  to: string
  userId?: string
  monthlyLimit: number
  planName: string
  resetDate: string
}): Promise<EnqueueResult> {
  return enqueueEmail({
    tenantId: opts.tenantId,
    to: opts.to,
    userId: opts.userId,
    template: 'billing.limit_reached',
    vars: {
      monthlyLimit: opts.monthlyLimit,
      plan: opts.planName,
      resetDate: opts.resetDate,
    },
    dedupKey: `billing_limit_${opts.tenantId}_${new Date().toISOString().slice(0, 10)}`, // daily dedup
  })
}

/**
 * Fire new-device-login alert.
 */
export async function notifyNewDeviceLogin(opts: {
  tenantId: string
  to: string
  userId?: string
  name?: string
  ip: string
  location?: string
  device: string
  timestamp?: string
}): Promise<EnqueueResult> {
  return enqueueEmail({
    tenantId: opts.tenantId,
    to: opts.to,
    userId: opts.userId,
    template: 'auth.new_device',
    vars: {
      name: opts.name,
      ip: opts.ip,
      location: opts.location ?? 'Unknown location',
      device: opts.device,
      timestamp: opts.timestamp ?? new Date().toISOString(),
    },
    dedupKey: `new_device_${opts.userId ?? opts.to}_${opts.ip}`, // one per IP per user per 10min
  })
}

/**
 * Fire failed-login alert (after N failed attempts in a window).
 */
export async function notifyFailedLogins(opts: {
  tenantId: string
  to: string
  userId?: string
  name?: string
  attempts: number
  window: string
  ip: string
}): Promise<EnqueueResult> {
  return enqueueEmail({
    tenantId: opts.tenantId,
    to: opts.to,
    userId: opts.userId,
    template: 'auth.failed_login',
    vars: {
      name: opts.name,
      attempts: opts.attempts,
      window: opts.window,
      ip: opts.ip,
    },
    dedupKey: `failed_logins_${opts.userId ?? opts.to}_${opts.ip}`, // one per IP per 10min
  })
}

/**
 * Fire injection-detected alert.
 */
export async function notifyInjectionDetected(opts: {
  tenantId: string
  to: string
  userId?: string
  name?: string
  reasons: string
  ip: string
  sessionId: string
}): Promise<EnqueueResult> {
  return enqueueEmail({
    tenantId: opts.tenantId,
    to: opts.to,
    userId: opts.userId,
    template: 'security.injection_detected',
    vars: {
      name: opts.name,
      reasons: opts.reasons,
      ip: opts.ip,
      sessionId: opts.sessionId,
      timestamp: new Date().toISOString(),
    },
    dedupKey: `injection_${opts.tenantId}_${opts.ip}`, // one per IP per 10min
  })
}

// ---------------------------------------------------------------------------
// Tenant admin lookup (recipient for tenant-level alerts)
// ---------------------------------------------------------------------------

/**
 * Get the primary admin user for a tenant (first admin, or fall back to
 * the first user). Returns email + id + name.
 *
 * Used for tenant-level alerts (billing, injection, API key changes) where
 * there's no specific end-user recipient.
 */
export async function getTenantAdminRecipient(tenantId: string): Promise<{
  userId: string
  email: string
  name: string | null
} | null> {
  const admin = await db.platformUser.findFirst({
    where: { tenantId, role: 'admin' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  })
  if (admin) {
    return { userId: admin.id, email: admin.email, name: admin.name }
  }

  // Fallback: any user on the tenant
  const fallback = await db.platformUser.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true },
  })
  if (!fallback) return null
  return { userId: fallback.id, email: fallback.email, name: fallback.name }
}
