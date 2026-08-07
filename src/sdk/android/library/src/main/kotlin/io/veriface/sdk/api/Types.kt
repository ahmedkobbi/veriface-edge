package io.veriface.sdk.api

/** SDK configuration. */
data class VeriFaceConfig(
    val tenantId: String,
    val apiKey: String,
    val apiBaseUrl: String = "https://api.veriface.io",
    val modelVersion: String = "v1.0.0",
    val captureDurationMs: Int = 1800,
    val livenessThreshold: Double = 0.78,
    val telemetryOptIn: Boolean = false
)

enum class VeriFaceFlow(val value: String) {
    ENROLL("enroll"),
    AUTHENTICATE("authenticate")
}

/** Response from /api/session/init. */
data class SessionInitResponse(
    val success: Boolean,
    val sessionId: String,
    val challenge: String,
    val backendPubKey: String,
    val expiresAt: String,
    val experiment: ExperimentContext?
)

data class ExperimentContext(
    val experimentId: String?,
    val variant: String?,
    val livenessThreshold: Double
)

/** Response from /api/session/verify. */
data class SessionVerifyResponse(
    val success: Boolean,
    val token: String?,
    val expiresAt: Long?,
    val sessionId: String,
    val flow: String,
    val errorCode: String?,
    val error: String?
)

/** SDK errors. */
sealed class VeriFaceError(message: String) : Exception(message) {
    object NoCamera : VeriFaceError("No camera available")
    object CameraDenied : VeriFaceError("Camera permission denied")
    object NoFace : VeriFaceError("No face detected")
    object MultipleFaces : VeriFaceError("Multiple faces detected")
    data class LivenessFailed(val score: Double, val threshold: Double) :
        VeriFaceError("Liveness score $score below threshold $threshold")
    data class InjectionSuspected(val reasons: List<String>) :
        VeriFaceError("Anti-injection failed: ${reasons.joinToString(", ")}")
    object SessionExpired : VeriFaceError("Session expired")
    data class NetworkError(val status: Int, val msg: String) :
        VeriFaceError("Network error: HTTP $status — $msg")
    data class VerificationFailed(val code: String, val msg: String) :
        VeriFaceError("Verification failed [$code]: $msg")
    data class Unknown(val msg: String) : VeriFaceError(msg)
}
