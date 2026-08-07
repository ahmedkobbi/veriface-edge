package io.veriface.sdk.api

import io.veriface.sdk.security.VeriFaceSecurity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** HTTP client for /api/session/init + /api/session/verify. */
class VeriFaceApi(private val config: VeriFaceConfig) {

    private val client: OkHttpClient = run {
        val builder = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)

        // Enforce certificate pinning for production backends
        // (skip for localhost / dev environments)
        val apiHost = try {
            java.net.URI(config.apiBaseUrl).host
        } catch (e: Exception) {
            null
        }

        if (apiHost != null && !apiHost.isNullOrEmpty() && apiHost != "localhost" && !apiHost.startsWith("10.") && !apiHost.startsWith("192.168.")) {
            val security = VeriFaceSecurity(android.app.Application())  // Note: in production, pass real Context
            builder.certificatePinner(security.createCertificatePinner())
        }

        builder.build()
    }

    private val jsonMediaType = "application/json".toMediaType()

    suspend fun initSession(
        flow: VeriFaceFlow,
        externalUserId: String?
    ): SessionInitResponse {
        val body = JSONObject().apply {
            put("tenantId", config.tenantId)
            put("flow", flow.value)
            externalUserId?.let { put("externalUserId", it) }
        }

        val request = Request.Builder()
            .url("${config.apiBaseUrl}/api/session/init")
            .post(body.toString().toRequestBody(jsonMediaType))
            .addHeader("Authorization", "Bearer ${config.apiKey}")
            .addHeader("Content-Type", "application/json")
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw VeriFaceError.NetworkError(response.code, "Session init failed")
        }

        val json = JSONObject(response.body?.string() ?: "{}")
        if (!json.optBoolean("success")) {
            throw VeriFaceError.NetworkError(response.code, json.optString("error", "Session init failed"))
        }

        val experiment = json.optJSONObject("experiment")?.let {
            ExperimentContext(
                experimentId = it.optString("experimentId", null),
                variant = it.optString("variant", null),
                livenessThreshold = it.optDouble("livenessThreshold", 0.78)
            )
        }

        return SessionInitResponse(
            success = json.getBoolean("success"),
            sessionId = json.getString("sessionId"),
            challenge = json.getString("challenge"),
            backendPubKey = json.getString("backendPubKey"),
            expiresAt = json.getString("expiresAt"),
            experiment = experiment
        )
    }

    suspend fun verifySession(
        sessionId: String,
        tenantId: String,
        jwt: String,
        sdkPubKey: String,
        encryptedEmbedding: Map<String, String>,
        commitment: String,
        commitmentNonce: String,
        liveness: io.veriface.sdk.pipeline.LivenessReport,
        antiInjection: io.veriface.sdk.pipeline.AntiInjectionReport,
        externalUserId: String?
    ): SessionVerifyResponse {
        val body = JSONObject().apply {
            put("sessionId", sessionId)
            put("tenantId", tenantId)
            put("jwt", jwt)
            put("sdkPubKey", sdkPubKey)
            put("encryptedEmbedding", JSONObject(encryptedEmbedding))
            put("commitment", commitment)
            put("commitmentNonce", commitmentNonce)
            put("liveness", liveness.toJson())
            put("antiInjection", antiInjection.toJson())
            externalUserId?.let { put("externalUserId", it) }
        }

        val request = Request.Builder()
            .url("${config.apiBaseUrl}/api/session/verify")
            .post(body.toString().toRequestBody(jsonMediaType))
            .addHeader("Authorization", "Bearer ${config.apiKey}")
            .addHeader("Content-Type", "application/json")
            .addHeader("X-VeriFace-Timestamp", System.currentTimeMillis().toString())
            .addHeader("X-VeriFace-Nonce", java.util.UUID.randomUUID().toString().replace("-", ""))
            .build()

        val response = client.newCall(request).execute()
        val json = JSONObject(response.body?.string() ?: "{}")

        return SessionVerifyResponse(
            success = json.optBoolean("success"),
            token = json.optString("token", null),
            expiresAt = if (json.has("expiresAt")) json.getLong("expiresAt") else null,
            sessionId = json.optString("sessionId", sessionId),
            flow = json.optString("flow", "authenticate"),
            errorCode = json.optString("errorCode", null),
            error = json.optString("error", null)
        )
    }
}
