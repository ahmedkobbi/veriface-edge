package io.veriface.sdk.crypto

import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.digests.Blake3Digest
import org.bouncycastle.crypto.engines.AESEngine
import org.bouncycastle.crypto.modes.GCMBlockCipher
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.json.JSONObject
import java.security.SecureRandom

/** All crypto primitives for the VeriFace SDK. */
class VeriFaceCrypto {

    private val random = SecureRandom()

    // Ephemeral session keys (rotated per session)
    private val signingKey: Ed25519PrivateKeyParameters
    private val keyAgreementKeyPair: X25519KeyPair

    init {
        // Generate Ed25519 signing keypair
        val gen = Ed25519KeyPairGenerator()
        gen.init(Ed25519KeyGenerationParameters(random))
        val signingKeyPair = gen.generateKeyPair()
        this.signingKey = signingKeyPair.private as Ed25519PrivateKeyParameters

        // Generate X25519 key agreement keypair
        this.keyAgreementKeyPair = generateX25519KeyPair()
    }

    /** X25519 keypair (private + public key bytes). */
    data class X25519KeyPair(val privateKey: ByteArray, val publicKey: ByteArray)

    private fun generateX25519KeyPair(): X25519KeyPair {
        val privateKey = ByteArray(32)
        random.nextBytes(privateKey)
        val agreement = X25519Agreement()
        agreement.init(privateKey)
        val publicKey = ByteArray(agreement.agreementSize)
        agreement.generatePublicKey(publicKey, 0)
        return X25519KeyPair(privateKey, publicKey)
    }

    /** Session X25519 public key as hex. */
    fun sessionPublicKeyHex(): String = bytesToHex(keyAgreementKeyPair.publicKey)

    /** Generate cryptographically secure random bytes. */
    fun secureRandom(count: Int): ByteArray {
        val bytes = ByteArray(count)
        random.nextBytes(bytes)
        return bytes
    }

    fun secureRandomHex(count: Int): String = bytesToHex(secureRandom(count))

    // MARK: - Session key derivation (X25519 ECDH + HKDF-SHA256)

    fun deriveSessionKey(backendPubKeyHex: String, challengeHex: String): ByteArray {
        val backendPubKey = hexToBytes(backendPubKeyHex)
        val challenge = hexToBytes(challengeHex)

        // X25519 ECDH shared secret
        val agreement = X25519Agreement()
        agreement.init(keyAgreementKeyPair.privateKey)
        val sharedSecret = ByteArray(agreement.agreementSize)
        agreement.calculateAgreement(backendPubKey, sharedSecret, 0)

        // HKDF-SHA256: derive 32-byte AES key
        val hkdf = HKDFBytesGenerator(SHA256Digest())
        hkdf.init(HKDFParameters(sharedSecret, challenge, "veriface-session-v1".toByteArray()))
        val derivedKey = ByteArray(32)
        hkdf.generateBytes(derivedKey, 0, 32)

        // Wipe shared secret from memory
        sharedSecret.fill(0)

        return derivedKey
    }

    // MARK: - Embedding encryption (AES-256-GCM)

    data class EncryptedEmbedding(
        val ciphertext: ByteArray,
        val iv: ByteArray,
        val authTag: ByteArray
    ) {
        fun asMap(): Map<String, String> = mapOf(
            "ciphertext" to bytesToHex(ciphertext),
            "iv" to bytesToHex(iv),
            "authTag" to bytesToHex(authTag)
        )
    }

    fun encryptEmbedding(
        embedding: FloatArray,
        key: ByteArray,
        aad: ByteArray
    ): EncryptedEmbedding {
        val plaintext = embeddingToBytes(embedding)
        val iv = ByteArray(12) // 96-bit IV (standard for GCM)
        random.nextBytes(iv)

        val cipher = GCMBlockCipher.newInstance(AESEngine.newInstance())
        cipher.init(true, AEADParameters(KeyParameter(key), 128, iv, aad))

        val ciphertext = ByteArray(cipher.getOutputSize(plaintext.size))
        var offset = cipher.processBytes(plaintext, 0, plaintext.size, ciphertext, 0)
        offset += cipher.doFinal(ciphertext, offset)

        // Split ciphertext + auth tag (GCM appends 16-byte tag)
        val ctOnly = ciphertext.copyOfRange(0, offset - 16)
        val tag = ciphertext.copyOfRange(offset - 16, offset)

        return EncryptedEmbedding(ctOnly, iv, tag)
    }

    // MARK: - Pedersen commitment (BLAKE3)

    fun createCommitment(embedding: FloatArray, nonce: ByteArray): String {
        val embBytes = embeddingToBytes(embedding)
        val input = embBytes + nonce
        val digest = Blake3Digest(256)
        digest.update(input, 0, input.size)
        val hash = ByteArray(digest.digestSize)
        digest.doFinal(hash, 0)
        return bytesToHex(hash)
    }

    // MARK: - JWT signing (Ed25519)

    fun signJwt(
        sessionId: String,
        tenantId: String,
        liveness: io.veriface.sdk.pipeline.LivenessReport,
        antiInjection: io.veriface.sdk.pipeline.AntiInjectionReport,
        commitment: String
    ): String {
        val header = JSONObject().apply {
            put("alg", "EdDSA")
            put("typ", "JWT")
        }
        val now = System.currentTimeMillis() / 1000
        val payload = JSONObject().apply {
            put("iss", "veriface-edge-sdk-android")
            put("sub", sessionId)
            put("iat", now)
            put("exp", now + 60)
            put("jti", sessionId)
            put("session_id", sessionId)
            put("tenant_id", tenantId)
            put("model_version", "v1.0.0")
            put("liveness_score", liveness.overall)
            put("commitment", commitment)
        }

        val headerB64 = base64UrlEncode(header.toString().toByteArray())
        val payloadB64 = base64UrlEncode(payload.toString().toByteArray())
        val signingInput = "$headerB64.$payloadB64"

        val signer = Ed25519Signer()
        signer.init(true, signingKey)
        val inputBytes = signingInput.toByteArray()
        signer.update(inputBytes, 0, inputBytes.size)
        val signature = signer.generateSignature()

        val sigB64 = base64UrlEncode(signature)
        return "$signingInput.$sigB64"
    }

    // MARK: - Helpers

    private fun embeddingToBytes(embedding: FloatArray): ByteArray {
        val bytes = ByteArray(embedding.size * 4)
        for (i in embedding.indices) {
            val bits = java.lang.Float.floatToRawIntBits(embedding[i])
            // Little-endian
            bytes[i * 4] = (bits and 0xFF).toByte()
            bytes[i * 4 + 1] = ((bits shr 8) and 0xFF).toByte()
            bytes[i * 4 + 2] = ((bits shr 16) and 0xFF).toByte()
            bytes[i * 4 + 3] = ((bits shr 24) and 0xFF).toByte()
        }
        return bytes
    }

    fun bytesToHex(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02x".format(it) }
    }

    fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "Hex string must have even length" }
        return ByteArray(hex.length / 2) { i ->
            ((Character.digit(hex[i * 2], 16) shl 4) +
             Character.digit(hex[i * 2 + 1], 16)).toByte()
        }
    }

    private fun base64UrlEncode(bytes: ByteArray): String {
        return android.util.Base64.encodeToString(
            bytes,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING
        )
    }
}
