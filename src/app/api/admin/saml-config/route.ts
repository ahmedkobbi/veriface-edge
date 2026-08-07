/**
 * GET /api/admin/saml-config — Get SAML configuration
 * PUT /api/admin/saml-config — Create or update SAML configuration
 *
 * Configures SAML SSO for the tenant:
 *   - IdP entity ID, SSO URL, certificate
 *   - SP entity ID, ACS URL (auto-generated defaults)
 *   - Attribute mappings (email, name)
 *   - Enable/disable + auto-provision toggle
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import { getDefaultSPEntityId, getDefaultAcsUrl } from '@/lib/saml'
import { safeErrorResponse } from '@/lib/config'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const SamlConfigSchema = z.object({
  idpEntityId: z.string().min(1).max(512),
  idpSsoUrl: z.string().url(),
  idpCertificate: z.string().min(1), // PEM certificate
  spEntityId: z.string().min(1).optional(),
  spAcsUrl: z.string().url().optional(),
  emailAttribute: z.string().default('email'),
  nameAttribute: z.string().default('name'),
  enabled: z.boolean().default(false),
  autoProvision: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const config = await db.samlConfig.findUnique({
    where: { tenantId: session.tenantId },
  })

  return NextResponse.json({
    success: true,
    config: config ?? null,
    defaults: {
      spEntityId: getDefaultSPEntityId(),
      spAcsUrl: getDefaultAcsUrl(),
      metadataUrl: `${getDefaultSPEntityId()}?tenant=${session.tenantId}`,
      acsUrl: getDefaultAcsUrl(),
    },
  })
}

export async function PUT(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can configure SAML' }, { status: 403 })
  }

  const body = await req.json()
  const validation = SamlConfigSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const data = validation.data
  const spEntityId = data.spEntityId ?? getDefaultSPEntityId()
  const spAcsUrl = data.spAcsUrl ?? getDefaultAcsUrl()

  // Upsert (create or update)
  const config = await db.samlConfig.upsert({
    where: { tenantId: session.tenantId },
    create: {
      tenantId: session.tenantId,
      idpEntityId: data.idpEntityId,
      idpSsoUrl: data.idpSsoUrl,
      idpCertificate: data.idpCertificate,
      spEntityId,
      spAcsUrl,
      emailAttribute: data.emailAttribute,
      nameAttribute: data.nameAttribute,
      enabled: data.enabled,
      autoProvision: data.autoProvision,
    },
    update: {
      idpEntityId: data.idpEntityId,
      idpSsoUrl: data.idpSsoUrl,
      idpCertificate: data.idpCertificate,
      spEntityId,
      spAcsUrl,
      emailAttribute: data.emailAttribute,
      nameAttribute: data.nameAttribute,
      enabled: data.enabled,
      autoProvision: data.autoProvision,
    },
  })

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: { action: 'saml_config_updated', enabled: data.enabled },
  })

  logger.info({ tenantId: session.tenantId, enabled: data.enabled }, 'SAML config updated')

  return NextResponse.json({
    success: true,
    config,
    metadataUrl: `${spEntityId}?tenant=${session.tenantId}`,
  })
}
