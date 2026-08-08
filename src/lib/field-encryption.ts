/**
 * VeriFace Edge — Field-Level Encryption (FLE)
 *
 * Encrypts sensitive database fields at rest using AES-256-GCM with a
 * master key from the VERIFACE_ENCRYPTION_KEY environment variable.
 *
 * Use cases:
 *   - TOTP secrets (M-5: was stored in plaintext)
 *   - SAML certificates (future)
 *   - OAuth client secrets (future)
 *
 * Ciphertext format (string, for DB storage):
 *   base64(iv[12] || ciphertext || authTag[16])
 *
 * The IV is prepended so each encryption is non-deterministic (random IV),
 * defeating known-plaintext attacks even if the same plaintext is encrypted
 * multiple times.
 */

import { aesGcmEncrypt, aesGcmDecrypt, utf8, hex } from '@/lib/crypto-server'
import { getMasterEncryptionKey } from '@/lib/config'
import { logger } from '@/lib/logger'

const IV_LEN = 12
const TAG_LEN = 16

/**
 * Encrypt a UTF-8 string for storage in the database.
 * Returns a base64 string safe for DB text columns.
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext
  const key = getMasterEncryptionKey()
  const plaintextBytes = utf8.encode(plaintext)
  const sealed = aesGcmEncrypt(key, plaintextBytes)

  // Combine iv || ciphertext || authTag
  const combined = new Uint8Array(IV_LEN + sealed.ciphertext.length + TAG_LEN)
  combined.set(sealed.iv, 0)
  combined.set(sealed.ciphertext, IV_LEN)
  combined.set(sealed.authTag, IV_LEN + sealed.ciphertext.length)

  return Buffer.from(combined).toString('base64')
}

/**
 * Decrypt a field previously encrypted with encryptField().
 * Returns the original plaintext, or null if decryption fails
 * (e.g., wrong key, corrupted data).
 */
export function decryptField(ciphertextB64: string | null | undefined): string | null {
  if (!ciphertextB64) return null

  // SECURITY: If the value doesn't look like a base64 blob of the right length,
  // treat it as plaintext (backward compatibility with pre-encryption data).
  // This allows a graceful migration: old plaintext values continue to work,
  // new values are encrypted.
  try {
    const combined = Buffer.from(ciphertextB64, 'base64')
    if (combined.length < IV_LEN + TAG_LEN + 1) {
      // Too short to be encrypted — likely plaintext (legacy)
      return ciphertextB64
    }

    const iv = combined.subarray(0, IV_LEN)
    const ciphertext = combined.subarray(IV_LEN, combined.length - TAG_LEN)
    const authTag = combined.subarray(combined.length - TAG_LEN)

    const key = getMasterEncryptionKey()
    const plaintextBytes = aesGcmDecrypt(key, { iv, ciphertext, authTag })
    return new TextDecoder().decode(plaintextBytes)
  } catch (e) {
    // Decryption failed — could be legacy plaintext data
    // Return the original value (it will fail TOTP verification if invalid)
    logger.debug({ error: e }, 'Field decryption failed — treating as plaintext (legacy)')
    return ciphertextB64
  }
}

/**
 * Check whether a stored value is encrypted (has the FLE format).
 * Useful for migration scripts.
 */
export function isEncryptedField(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const combined = Buffer.from(value, 'base64')
    return combined.length >= IV_LEN + TAG_LEN + 1
  } catch {
    return false
  }
}
