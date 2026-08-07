// VeriFace Edge — API types

/// Configuration for the VeriFace client.
class VeriFaceConfig {
  final String tenantId;
  final String apiKey;
  final String apiBaseUrl;
  final String modelVersion;
  final int captureDurationMs;
  final double livenessThreshold;
  final bool telemetryOptIn;

  const VeriFaceConfig({
    required this.tenantId,
    required this.apiKey,
    this.apiBaseUrl = 'https://api.veriface.io',
    this.modelVersion = 'v1.0.0',
    this.captureDurationMs = 1800,
    this.livenessThreshold = 0.78,
    this.telemetryOptIn = false,
  });
}

/// Response from /api/session/init.
class SessionInitResponse {
  final bool success;
  final String sessionId;
  final String challenge; // hex
  final String backendPubKey; // hex X25519 public key
  final DateTime expiresAt;
  final ExperimentContext? experiment;

  SessionInitResponse({
    required this.success,
    required this.sessionId,
    required this.challenge,
    required this.backendPubKey,
    required this.expiresAt,
    this.experiment,
  });

  factory SessionInitResponse.fromJson(Map<String, dynamic> json) {
    return SessionInitResponse(
      success: json['success'] as bool,
      sessionId: json['sessionId'] as String,
      challenge: json['challenge'] as String,
      backendPubKey: json['backendPubKey'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
      experiment: json['experiment'] != null
          ? ExperimentContext.fromJson(json['experiment'] as Map<String, dynamic>)
          : null,
    );
  }
}

/// A/B test experiment context (returned by /api/session/init if an
/// experiment is active).
class ExperimentContext {
  final String? experimentId;
  final String? variant;
  final double livenessThreshold;

  ExperimentContext({
    this.experimentId,
    this.variant,
    required this.livenessThreshold,
  });

  factory ExperimentContext.fromJson(Map<String, dynamic> json) {
    return ExperimentContext(
      experimentId: json['experimentId'] as String?,
      variant: json['variant'] as String?,
      livenessThreshold: (json['livenessThreshold'] as num).toDouble(),
    );
  }
}

/// Liveness scores reported by the SDK.
class LivenessReport {
  final double rppg;
  final double? rppgHeartRateBpm;
  final double rppgSnr;
  final double padTexture;
  final double padDepth;
  final double padCombined;
  final double overall;

  LivenessReport({
    required this.rppg,
    this.rppgHeartRateBpm,
    required this.rppgSnr,
    required this.padTexture,
    required this.padDepth,
    required this.padCombined,
    required this.overall,
  });

  Map<String, dynamic> toJson() => {
    'rppg': rppg,
    'rppgHeartRateBpm': rppgHeartRateBpm,
    'rppgSnr': rppgSnr,
    'padTexture': padTexture,
    'padDepth': padDepth,
    'padCombined': padCombined,
    'overall': overall,
  };
}

/// Anti-injection report (signals from the SDK's anti-tamper checks).
class AntiInjectionReport {
  final bool passed;
  final List<String> failureReasons;
  final bool replayDetected;
  final int strobeChallenges;
  final int strobeResponses;

  AntiInjectionReport({
    required this.passed,
    this.failureReasons = const [],
    this.replayDetected = false,
    this.strobeChallenges = 0,
    this.strobeResponses = 0,
  });

  Map<String, dynamic> toJson() => {
    'passed': passed,
    'failureReasons': failureReasons,
    'replayDetected': replayDetected,
    'strobeChallenges': strobeChallenges,
    'strobeResponses': strobeResponses,
    'deviceScan': <String, dynamic>{},
    'timingStats': <String, dynamic>{},
    'tamperCheck': <String, dynamic>{},
    'attestation': <String, dynamic>{},
  };
}

/// Payload sent to /api/session/verify.
class SessionVerifyPayload {
  final String sessionId;
  final String tenantId;
  final String jwt;
  final String sdkPubKey;
  final Map<String, dynamic> encryptedEmbedding;
  final String commitment;
  final String commitmentNonce;
  final LivenessReport liveness;
  final AntiInjectionReport antiInjection;
  final String? externalUserId;

  SessionVerifyPayload({
    required this.sessionId,
    required this.tenantId,
    required this.jwt,
    required this.sdkPubKey,
    required this.encryptedEmbedding,
    required this.commitment,
    required this.commitmentNonce,
    required this.liveness,
    required this.antiInjection,
    this.externalUserId,
  });

  Map<String, dynamic> toJson() => {
    'sessionId': sessionId,
    'tenantId': tenantId,
    'jwt': jwt,
    'sdkPubKey': sdkPubKey,
    'encryptedEmbedding': encryptedEmbedding,
    'commitment': commitment,
    'commitmentNonce': commitmentNonce,
    'liveness': liveness.toJson(),
    'antiInjection': antiInjection.toJson(),
    if (externalUserId != null) 'externalUserId': externalUserId,
  };
}

/// Response from /api/session/verify.
class SessionVerifyResponse {
  final bool success;
  final String? token;
  final int? expiresAt;
  final String sessionId;
  final String flow;
  final String? errorCode;
  final String? error;

  SessionVerifyResponse({
    required this.success,
    this.token,
    this.expiresAt,
    required this.sessionId,
    required this.flow,
    this.errorCode,
    this.error,
  });

  factory SessionVerifyResponse.fromJson(Map<String, dynamic> json) {
    return SessionVerifyResponse(
      success: json['success'] as bool,
      token: json['token'] as String?,
      expiresAt: json['expiresAt'] as int?,
      sessionId: json['sessionId'] as String,
      flow: json['flow'] as String,
      errorCode: json['errorCode'] as String?,
      error: json['error'] as String?,
    );
  }
}
