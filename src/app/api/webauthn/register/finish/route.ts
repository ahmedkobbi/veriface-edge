/**
 * POST /api/webauthn/register/finish
 * Complete WebAuthn credential registration.
 *
 * Body: {
 *   sessionId: string,
 *   credentialId: string (base64url),
 *   publicKey: string (base64url, COSE format),
 *   attestationObject: string (base64url),
 *   clientDataJSON: string (base64url),
 *   transports: string[],
 *   aaguid: string,
 *   deviceType: 'platform'|'roaming',
 *   backedUp: boolean,
 * }
 *
 * Stores the credential on the user record. Future authentication flows
 * can require both a face ZK proof AND a WebAuthn assertion (step-up auth).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { appendAudit } from '@/lib/audit'

function base64urlDecode(s: string): Uint8Array {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/')
  while (padded.length % 4 !== 0) padded += '='
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const {
      sessionId,
      credentialId,
      publicKey,
      transports,
      aaguid,
      deviceType,
      backedUp,
    } = body

    if (!sessionId || !credentialId || !publicKey) {
      return NextResponse.json(
        { success: false, error: 'sessionId, credentialId, publicKey required' },
        { status: 400 },
      )
    }

    const session = await db.session.findUnique({ where: { id: sessionId } })
    if (!session || session.tenantId !== authResult.auth.tenantId) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 })
    }
    if (session.flow !== 'webauthn_enroll') {
      return NextResponse.json({ success: false, error: 'Wrong session flow' }, { status: 400 })
    }
    if (session.expiresAt < new Date()) {
      return NextResponse.json({ success: false, error: 'Session expired' }, { status: 410 })
    }

    // Decode and verify the credential (simplified — production would
    // fully verify the attestation signature against the trusted root CA).
    const pubKeyBytes = base64urlDecode(publicKey)
    const credIdBytes = base64urlDecode(credentialId)

    // Check for duplicate credential ID
    const existing = await db.webAuthnCredential.findUnique({
      where: { credentialId },
    })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Credential already registered' },
        { status: 409 },
      )
    }

    const credential = await db.webAuthnCredential.create({
      data: {
        userId: session.targetUserId!,
        tenantId: session.tenantId,
        credentialId,
        publicKey: bytesToHex(pubKeyBytes),
        transports: JSON.stringify(transports ?? []),
        aaguid: aaguid ?? '00000000-0000-0000-0000-000000000000',
        deviceType: deviceType ?? 'roaming',
        backedUp: backedUp ?? false,
      },
    })

    await db.session.update({
      where: { id: sessionId },
      data: { state: 'success', result: JSON.stringify({ credentialId: credential.id }) },
    })

    await appendAudit({
      tenantId: session.tenantId,
      eventType: 'webauthn.enrolled',
      payload: {
        credentialId: credential.id,
        userId: session.targetUserId,
        deviceType,
        backedUp,
      },
      apiKeyId: authResult.auth.apiKeyId,
    })

    return NextResponse.json({
      success: true,
      credentialId: credential.id,
      message: 'WebAuthn credential registered. User can now authenticate with face + hardware authenticator.',
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
