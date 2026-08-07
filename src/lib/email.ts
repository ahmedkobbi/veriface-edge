/**
 * VeriFace Edge — Email Service
 *
 * Sends transactional emails:
 *   - Email verification
 *   - Password reset
 *   - Welcome email
 *   - Security alerts
 *
 * Uses Nodemailer with SMTP (production: AWS SES / SendGrid).
 * Falls back to console.log in development (no SMTP configured).
 *
 * Environment:
 *   SMTP_HOST — SMTP server hostname
 *   SMTP_PORT — SMTP port (587 for TLS, 465 for SSL)
 *   SMTP_USER — SMTP username
 *   SMTP_PASS — SMTP password
 *   SMTP_FROM — From email address (e.g., noreply@veriface.io)
 *   APP_URL — Base URL for links (e.g., https://veriface.io)
 */

import { logger } from '@/lib/logger'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.SITE_URL ?? 'http://localhost:3000'
const SMTP_FROM = process.env.SMTP_FROM ?? 'noreply@veriface.io'

interface EmailParams {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * Send an email. In development (no SMTP configured), logs to console.
 * In production, uses Nodemailer with SMTP.
 */
export async function sendEmail(params: EmailParams): Promise<boolean> {
  const { to, subject, html, text } = params

  // Check if SMTP is configured
  const smtpHost = process.env.SMTP_HOST
  if (!smtpHost) {
    // Development mode — log the email
    logger.info({ to, subject }, 'Email sent (dev mode — no SMTP)')
    console.log(`\n📧 EMAIL (dev mode)\n  To: ${to}\n  Subject: ${subject}\n  ---\n  ${text ?? html.replace(/<[^>]*>/g, '')}\n  ---\n`)
    return true
  }

  try {
    // Dynamic import — only load nodemailer when SMTP is configured
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html,
      text: text ?? html.replace(/<[^>]*>/g, ''),
    })

    logger.info({ to, subject }, 'Email sent')
    return true
  } catch (e) {
    logger.error({ error: e, to, subject }, 'Failed to send email')
    return false
  }
}

/**
 * Send email verification link.
 */
export async function sendVerificationEmail(email: string, token: string, name?: string): Promise<boolean> {
  const link = `${APP_URL}/?verify_email=${token}`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #10b981; font-size: 24px; margin: 0;">VeriFace Edge</h1>
        <p style="color: #64748b; font-size: 12px; margin: 4px 0 0;">Privacy-First Facial Authentication</p>
      </div>
      <h2 style="color: #1e293b; font-size: 18px;">Verify your email address</h2>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">
        Hi ${name ?? 'there'},<br><br>
        Please verify your email address to complete your VeriFace Edge account setup.
        Click the button below to confirm:
      </p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${link}" style="background: linear-gradient(135deg, #10b981, #06b6d4); color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">
          Verify Email
        </a>
      </div>
      <p style="color: #94a3b8; font-size: 12px; line-height: 1.5;">
        Or copy this link: ${link}<br><br>
        This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
      <p style="color: #94a3b8; font-size: 11px; text-align: center;">
        © 2026 VeriFace Edge. All rights reserved.
      </p>
    </div>
  `
  return sendEmail({
    to: email,
    subject: 'Verify your email — VeriFace Edge',
    html,
    text: `Verify your email: ${link}`,
  })
}

/**
 * Send password reset link.
 */
export async function sendPasswordResetEmail(email: string, token: string, name?: string): Promise<boolean> {
  const link = `${APP_URL}/?reset_password=${token}`
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #10b981; font-size: 24px; margin: 0;">VeriFace Edge</h1>
        <p style="color: #64748b; font-size: 12px; margin: 4px 0 0;">Privacy-First Facial Authentication</p>
      </div>
      <h2 style="color: #1e293b; font-size: 18px;">Reset your password</h2>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">
        Hi ${name ?? 'there'},<br><br>
        We received a request to reset your password. Click the button below to choose a new password:
      </p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${link}" style="background: linear-gradient(135deg, #10b981, #06b6d4); color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #94a3b8; font-size: 12px; line-height: 1.5;">
        Or copy this link: ${link}<br><br>
        This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
      <p style="color: #94a3b8; font-size: 11px; text-align: center;">
        © 2026 VeriFace Edge. All rights reserved.
      </p>
    </div>
  `
  return sendEmail({
    to: email,
    subject: 'Reset your password — VeriFace Edge',
    html,
    text: `Reset your password: ${link}`,
  })
}

/**
 * Send security alert email.
 */
export async function sendSecurityAlertEmail(email: string, alert: {
  title: string
  message: string
  ip?: string
  timestamp: string
}): Promise<boolean> {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #ef4444; font-size: 24px; margin: 0;">⚠️ Security Alert</h1>
      </div>
      <h2 style="color: #1e293b; font-size: 18px;">${alert.title}</h2>
      <p style="color: #475569; font-size: 14px; line-height: 1.6;">${alert.message}</p>
      ${alert.ip ? `<p style="color: #94a3b8; font-size: 12px;">IP: ${alert.ip}</p>` : ''}
      <p style="color: #94a3b8; font-size: 12px;">Time: ${alert.timestamp}</p>
      <p style="color: #475569; font-size: 14px; margin-top: 16px;">
        If this wasn't you, please change your password immediately and contact support.
      </p>
    </div>
  `
  return sendEmail({
    to: email,
    subject: `⚠️ ${alert.title} — VeriFace Edge`,
    html,
  })
}
