/**
 * VeriFace Edge — SAML 2.0 Service Provider
 *
 * Implements SAML 2.0 SSO as a Service Provider (SP):
 *   - SP metadata generation (for IdP configuration)
 *   - SAML AuthnRequest creation (redirect user to IdP)
 *   - SAML Response parsing + verification (Assertion Consumer Service)
 *   - User provisioning from SAML attributes
 *
 * Compatible with: Okta, Azure AD (Entra ID), OneLogin, Google Workspace,
 * ADFS, Shibboleth, Auth0, Keycloak, PingFederate.
 *
 * Flow:
 *   1. User clicks "Sign in with SSO" → /api/saml/login?tenant=xxx
 *   2. Server generates SAML AuthnRequest → redirects to IdP SSO URL
 *   3. User authenticates at IdP → IdP POSTs SAML Response to /api/saml/acs
 *   4. Server verifies signature + extracts attributes → creates/links user
 *   5. Server issues session cookie → redirects to admin panel
 */

import * as samlify from 'samlify'
import { db } from '@/lib/db'
import { hashPassword, createSessionToken, buildCookieHeader } from '@/lib/platform-auth'
import { secureRandomHex } from '@/lib/crypto-server'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import type { SamlConfig } from '@prisma/client'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.SITE_URL ?? 'http://localhost:3000'

// ---------------------------------------------------------------------------
// SP/IdP provider creation from DB config
// ---------------------------------------------------------------------------

/**
 * Create a samlify Service Provider from tenant's SAML config.
 */
function createSP(config: SamlConfig) {
  const sp = samlify.ServiceProvider({
    entityID: config.spEntityId,
    authnRequestsSigned: false,
    wantAssertionsSigned: true,
    wantMessageSigned: false,
    assertionConsumerServiceUrl: config.spAcsUrl,
    singleLogoutServiceUrl: `${APP_URL}/api/saml/sls`,
  })

  const idp = samlify.IdentityProvider({
    entityID: config.idpEntityId,
    singleSignOnService: [{
      Binding: samlify.Constants.namespace.binding.redirect,
      Location: config.idpSsoUrl,
    }],
    singleLogoutService: [{
      Binding: samlify.Constants.namespace.binding.redirect,
      Location: config.idpSsoUrl,
    }],
    certificates: {
      signing: config.idpCertificate,
      encryption: config.idpCertificate,
    },
  })

  return { sp, idp }
}

// ---------------------------------------------------------------------------
// Get SAML config for a tenant
// ---------------------------------------------------------------------------

export async function getSamlConfig(tenantId: string): Promise<SamlConfig | null> {
  return db.samlConfig.findUnique({ where: { tenantId } })
}

// ---------------------------------------------------------------------------
// SP Metadata — XML that IdP admins import to configure the SP
// ---------------------------------------------------------------------------

export async function getSPMetadata(tenantId: string): Promise<string | null> {
  const config = await getSamlConfig(tenantId)
  if (!config || !config.enabled) return null

  const { sp } = createSP(config)
  return sp.getMetadata()
}

// ---------------------------------------------------------------------------
// Create SAML AuthnRequest — redirects user to IdP
// ---------------------------------------------------------------------------

export async function createLoginRequest(tenantId: string): Promise<string | null> {
  const config = await getSamlConfig(tenantId)
  if (!config || !config.enabled) return null

  const { sp, idp } = createSP(config)
  const { context } = sp.createLoginRequest(idp, 'redirect')
  return context
}

// ---------------------------------------------------------------------------
// Parse + verify SAML Response (POST binding from IdP)
// ---------------------------------------------------------------------------

export interface SamlUser {
  email: string
  name: string | null
  userId: string | null
  attributes: Record<string, string | string[]>
}

export async function parseSamlResponse(
  tenantId: string,
  samlResponse: string,
): Promise<SamlUser | null> {
  const config = await getSamlConfig(tenantId)
  if (!config || !config.enabled) return null

  const { sp, idp } = createSP(config)

  try {
    const result = await sp.parseLoginResponse(idp, 'post', {
      body: { SAMLResponse: samlResponse },
    })

    // Extract attributes
    const attrs = result.attributes || {}
    const email = String(attrs[config.emailAttribute] ?? attrs['email'] ?? attrs['EmailAddress'] ?? attrs['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ?? '')
    const name = String(attrs[config.nameAttribute] ?? attrs['name'] ?? attrs['Name'] ?? attrs['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ?? '')
    const userId = String(attrs['userId'] ?? attrs['UserID'] ?? attrs['subject'] ?? '')

    if (!email) {
      logger.error({ tenantId, attrs: Object.keys(attrs) }, 'SAML response missing email attribute')
      return null
    }

    return {
      email: email.toLowerCase(),
      name: name || null,
      userId: userId || null,
      attributes: attrs as Record<string, string | string[]>,
    }
  } catch (e) {
    logger.error({ error: e, tenantId }, 'SAML response parsing failed')
    return null
  }
}

// ---------------------------------------------------------------------------
// Provision or link user from SAML attributes
// ---------------------------------------------------------------------------

export async function provisionSamlUser(
  tenantId: string,
  samlUser: SamlUser,
  config: SamlConfig,
): Promise<{ user: any; isNewUser: boolean } | null> {
  // Check if user already exists
  let user = await db.platformUser.findUnique({
    where: { email: samlUser.email },
  })

  let isNewUser = false

  if (!user) {
    if (!config.autoProvision) {
      logger.warn({ tenantId, email: samlUser.email }, 'SAML user not found and auto-provision disabled')
      return null
    }

    // Auto-provision: create a new PlatformUser with a random password
    // (they'll authenticate via SAML, never need the password)
    const randomPassword = secureRandomHex(32) + 'Aa1!'
    const passwordHash = await hashPassword(randomPassword)

    user = await db.platformUser.create({
      data: {
        email: samlUser.email,
        passwordHash,
        name: samlUser.name,
        tenantId,
        emailVerified: true, // SAML IdP verified the email
        role: 'user',
      },
    })
    isNewUser = true

    logger.info({ userId: user.id, email: samlUser.email, tenantId }, 'SAML user auto-provisioned')
  } else {
    // User exists — update name if changed + ensure tenant link
    if (user.tenantId !== tenantId) {
      // User exists but not linked to this tenant — link them
      user = await db.platformUser.update({
        where: { id: user.id },
        data: { tenantId, name: samlUser.name ?? user.name },
      })
    } else if (samlUser.name && samlUser.name !== user.name) {
      user = await db.platformUser.update({
        where: { id: user.id },
        data: { name: samlUser.name },
      })
    }
  }

  return { user, isNewUser }
}

// ---------------------------------------------------------------------------
// Complete SAML login — parse response + provision user + issue session
// ---------------------------------------------------------------------------

export async function completeSamlLogin(
  tenantId: string,
  samlResponse: string,
): Promise<{ cookieHeader: string; user: any; isNewUser: boolean } | null> {
  const config = await getSamlConfig(tenantId)
  if (!config || !config.enabled) return null

  const samlUser = await parseSamlResponse(tenantId, samlResponse)
  if (!samlUser) return null

  const result = await provisionSamlUser(tenantId, samlUser, config)
  if (!result) return null

  const { user, isNewUser } = result

  // Update lastLoginAt
  await db.platformUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  // Issue session token
  const token = await createSessionToken(user.id, user.email, tenantId)

  await appendAudit({
    tenantId,
    eventType: 'auth.success',
    payload: {
      userId: user.id,
      email: user.email,
      method: 'saml',
      isNewUser,
    },
  })

  logger.info({ userId: user.id, email: user.email, method: 'saml' }, 'SAML login successful')

  return {
    cookieHeader: buildCookieHeader(token),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId,
      emailVerified: user.emailVerified,
    },
    isNewUser,
  }
}

// ---------------------------------------------------------------------------
// Default SP entity ID and ACS URL for a tenant
// ---------------------------------------------------------------------------

export function getDefaultSPEntityId(): string {
  return `${APP_URL}/api/saml/metadata`
}

export function getDefaultAcsUrl(): string {
  return `${APP_URL}/api/saml/acs`
}
