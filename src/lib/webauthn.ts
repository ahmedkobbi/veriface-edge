/**
 * VeriFace Edge — WebAuthn Server Helpers
 *
 * Full FIDO2/WebAuthn implementation using @simplewebauthn/server.
 * Handles:
 *   - Registration: attestation verification + credential storage
 *   - Authentication: assertion verification + counter increment (clone detection)
 *
 * Supports both platform authenticators (Touch ID, Windows Hello) and
 * roaming authenticators (YubiKey, Titan).
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server'
import { db } from '@/lib/db'
import { hex } from '@/lib/crypto-server'

const RP_NAME = 'VeriFace Edge'
const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost'
const RP_ORIGIN = process.env.WEBAUTHN_RP_ORIGIN ?? 'http://localhost:3000'

// H12: In production, refuse to use localhost defaults
if (process.env.NODE_ENV === 'production') {
  if (RP_ID === 'localhost' || !process.env.WEBAUTHN_RP_ID) {
    throw new Error('WEBAUTHN_RP_ID must be set to your domain in production (e.g., veriface.io)')
  }
  if (!process.env.WEBAUTHN_RP_ORIGIN || !process.env.WEBAUTHN_RP_ORIGIN.startsWith('https://')) {
    throw new Error('WEBAUTHN_RP_ORIGIN must be an HTTPS URL in production (e.g., https://veriface.io)')
  }
}

/**
 * Generate WebAuthn registration options for a user.
 */
export async function beginWebAuthnRegistration(
  tenantId: string,
  externalUserId: string,
  deviceType?: 'platform' | 'roaming',
) {
  // Find or create user
  let user = await db.user.findFirst({ where: { tenantId, externalUserId } })
  if (!user) {
    const { secureRandomHex } = await import('@/lib/crypto-server')
    user = await db.user.create({
      data: {
        tenantId,
        externalUserId,
        revocationToken: secureRandomHex(32),
      },
    })
  }

  // Get existing credentials to exclude
  const existingCreds = await db.webAuthnCredential.findMany({
    where: { tenantId, userId: user.id },
  })

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: externalUserId,
    userDisplayName: externalUserId,
    attestationType: 'direct',
    authenticatorSelection: {
      authenticatorAttachment: deviceType === 'platform' ? 'platform' : 'cross-platform',
      userVerification: 'required',
      requireResidentKey: false,
    },
    excludeCredentials: existingCreds.map((c) => ({
      id: c.credentialId,
      type: 'public-key' as const,
    })),
  })

  return { options, userId: user.id }
}

/**
 * Verify a WebAuthn registration response and store the credential.
 */
export async function finishWebAuthnRegistration(
  tenantId: string,
  userId: string,
  expectedChallenge: string,
  credentialResponse: any,
): Promise<{
  verified: boolean
  credentialId?: string
  credential?: any
}> {
  let verification: VerifiedRegistrationResponse
  try {
    verification = await verifyRegistrationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    })
  } catch (e) {
    return {
      verified: false,
    }
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false }
  }

  const info = verification.registrationInfo

  // Check for duplicate credential ID
  const existing = await db.webAuthnCredential.findUnique({
    where: { credentialId: info.credentialID },
  })
  if (existing) {
    return { verified: false }
  }

  // Store the credential
  const credential = await db.webAuthnCredential.create({
    data: {
      userId,
      tenantId,
      credentialId: info.credentialID,
      publicKey: hex.encode(new Uint8Array(info.credentialPublicKey)),
      counter: info.counter,
      transports: JSON.stringify(info.credentialDeviceType ?? []),
      aaguid: info.aaguid ?? '00000000-0000-0000-0000-000000000000',
      deviceType: info.credentialDeviceType ?? 'roaming',
      backedUp: info.credentialBackedUp ?? false,
    },
  })

  return {
    verified: true,
    credentialId: credential.id,
    credential,
  }
}

/**
 * Generate WebAuthn authentication options for a user.
 */
export async function beginWebAuthnAuthentication(
  tenantId: string,
  externalUserId: string,
) {
  const user = await db.user.findFirst({ where: { tenantId, externalUserId } })
  if (!user) {
    return { error: 'USER_NOT_FOUND' as const }
  }

  const credentials = await db.webAuthnCredential.findMany({
    where: { tenantId, userId: user.id },
  })

  if (credentials.length === 0) {
    return { error: 'NO_CREDENTIALS' as const }
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
      type: 'public-key' as const,
      transports: JSON.parse(c.transports) ?? [],
    })),
  })

  return { options, userId: user.id }
}

/**
 * Verify a WebAuthn authentication response.
 * Checks signature + counter increment (clone detection).
 */
export async function finishWebAuthnAuthentication(
  tenantId: string,
  expectedChallenge: string,
  assertionResponse: any,
): Promise<{
  verified: boolean
  userId?: string
  credentialId?: string
  error?: string
}> {
  // Find the credential by ID
  const credentialId = assertionResponse?.id
  if (!credentialId) {
    return { verified: false, error: 'NO_CREDENTIAL_ID' }
  }

  const credential = await db.webAuthnCredential.findUnique({
    where: { credentialId },
  })
  if (!credential || credential.tenantId !== tenantId) {
    return { verified: false, error: 'CREDENTIAL_NOT_FOUND' }
  }

  let verification: VerifiedAuthenticationResponse
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(hex.decode(credential.publicKey)),
        counter: credential.counter,
      },
      requireUserVerification: true,
    })
  } catch (e) {
    return {
      verified: false,
      error: e instanceof Error ? e.message : 'Verification failed',
    }
  }

  if (!verification.verified) {
    return { verified: false, error: 'Verification failed' }
  }

  // Update counter (clone detection)
  const newCounter = verification.authenticationInfo.newCounter
  await db.webAuthnCredential.update({
    where: { id: credential.id },
    data: { counter: newCounter, lastUsedAt: new Date() },
  })

  return {
    verified: true,
    userId: credential.userId,
    credentialId: credential.id,
  }
}
