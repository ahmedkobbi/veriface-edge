// VeriFaceClient.kt — Public API entry point
//
// Privacy contract:
//   - All biometric computation (face detection, rPPG, PAD, embedding) runs
//     natively on Android via CameraX + ML Kit — no WebView, no JS bridge.
//   - The SDK never writes face frames or embeddings to disk.
//   - Only the encrypted embedding + ZK commitment + scalar scores are sent
//     to the backend, end-to-end encrypted with the session ECDH key.
//
// Usage:
//   val client = VeriFaceClient(
//     context = applicationContext,
//     config = VeriFaceConfig(
//       tenantId = "tnt_...",
//       apiKey = "vf_live_...",
//       signingPrivateKey = "ed37ea33...", // 64 hex chars — returned once at tenant creation
//       apiBaseUrl = "https://api.veriface.io"
//     )
//   )
//   val result = client.authenticate(externalUserId = "user_123")
//   println("Token: ${result.token}")

package io.veriface.sdk

import android.content.Context
import io.veriface.sdk.api.VeriFaceApi
import io.veriface.sdk.api.VeriFaceConfig
import io.veriface.sdk.api.VeriFaceFlow
import io.veriface.sdk.api.VeriFaceError
import io.veriface.sdk.api.SessionInitResponse
import io.veriface.sdk.api.SessionVerifyResponse
import io.veriface.sdk.camera.VeriFaceCamera
import io.veriface.sdk.crypto.VeriFaceCrypto
import io.veriface.sdk.pipeline.VeriFacePipeline

class VeriFaceClient(
    private val context: Context,
    private val config: VeriFaceConfig
) {
    private val api = VeriFaceApi(config)

    // SECURITY FIX (S-01): Pass the tenant's signing private key to the crypto module.
    // The crypto module loads the Ed25519 private key from the hex string and uses it
    // to sign JWTs. Previously, the crypto module generated an ephemeral key — which
    // didn't match the backend's stored public key, causing every auth to fail.
    private val crypto = VeriFaceCrypto(config.signingPrivateKey)

    private val camera = VeriFaceCamera(context)
    private val pipeline = VeriFacePipeline().also { it.init(context) }

    /**
     * Run the full authentication/enrollment flow.
     *
     * MUST be called from a background thread (or a coroutine with Dispatchers.IO).
     * Throws [VeriFaceError] on any failure.
     */
    suspend fun authenticate(
        externalUserId: String? = null
    ): SessionVerifyResponse {
        // 1. Init session with backend
        val session = api.initSession(
            flow = VeriFaceFlow.AUTHENTICATE,
            externalUserId = externalUserId
        )

        // 2-5. Capture + AI pipeline
        val capture = camera.capture(durationMs = config.captureDurationMs)
        val processed = pipeline.process(capture)

        // Check liveness threshold
        if (processed.liveness.overall < config.livenessThreshold) {
            throw VeriFaceError.LivenessFailed(
                score = processed.liveness.overall,
                threshold = config.livenessThreshold
            )
        }

        // 6. Pedersen commitment
        val nonce = crypto.secureRandom(32)
        val commitment = crypto.createCommitment(
            embedding = processed.embedding,
            nonce = nonce
        )

        // 7. Encrypt embedding (AES-256-GCM with session key)
        val sessionKey = crypto.deriveSessionKey(
            backendPubKeyHex = session.backendPubKey,
            challengeHex = session.challenge
        )
        val encrypted = crypto.encryptEmbedding(
            embedding = processed.embedding,
            key = sessionKey,
            aad = crypto.hexToBytes(session.challenge)
        )

        // 8. Sign JWT (Ed25519)
        val jwt = crypto.signJwt(
            sessionId = session.sessionId,
            tenantId = config.tenantId,
            liveness = processed.liveness,
            antiInjection = processed.antiInjection,
            commitment = commitment
        )

        // 9. Verify
        return api.verifySession(
            sessionId = session.sessionId,
            tenantId = config.tenantId,
            jwt = jwt,
            sdkPubKey = crypto.sessionPublicKeyHex(),
            encryptedEmbedding = encrypted,
            commitment = commitment,
            commitmentNonce = crypto.bytesToHex(nonce),
            liveness = processed.liveness,
            antiInjection = processed.antiInjection,
            externalUserId = externalUserId
        )
    }

    /** Release all resources (camera, etc.). Call from Activity.onDestroy(). */
    fun release() {
        camera.release()
    }
}
