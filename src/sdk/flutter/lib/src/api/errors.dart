// VeriFace Edge — Errors

enum VeriFaceErrorCode {
  noWebgpu,
  cameraDenied,
  noCamera,
  virtualCameraOnly,
  injectionSuspected,
  extensionTamper,
  noFace,
  multipleFaces,
  livenessFailed,
  timingSynthetic,
  replayDetected,
  sessionExpired,
  networkError,
  verificationFailed,
  unsupportedBrowser,
  unsupportedPlatform,
  unknown,
}

extension VeriFaceErrorCodeX on VeriFaceErrorCode {
  String get label {
    switch (this) {
      case VeriFaceErrorCode.noWebgpu: return 'NO_WEBGPU';
      case VeriFaceErrorCode.cameraDenied: return 'CAMERA_DENIED';
      case VeriFaceErrorCode.noCamera: return 'NO_CAMERA';
      case VeriFaceErrorCode.virtualCameraOnly: return 'VIRTUAL_CAMERA_ONLY';
      case VeriFaceErrorCode.injectionSuspected: return 'INJECTION_SUSPECTED';
      case VeriFaceErrorCode.extensionTamper: return 'EXTENSION_TAMPER';
      case VeriFaceErrorCode.noFace: return 'NO_FACE';
      case VeriFaceErrorCode.multipleFaces: return 'MULTIPLE_FACES';
      case VeriFaceErrorCode.livenessFailed: return 'LIVENESS_FAILED';
      case VeriFaceErrorCode.timingSynthetic: return 'TIMING_SYNTHETIC';
      case VeriFaceErrorCode.replayDetected: return 'REPLAY_DETECTED';
      case VeriFaceErrorCode.sessionExpired: return 'SESSION_EXPIRED';
      case VeriFaceErrorCode.networkError: return 'NETWORK_ERROR';
      case VeriFaceErrorCode.verificationFailed: return 'VERIFICATION_FAILED';
      case VeriFaceErrorCode.unsupportedBrowser: return 'UNSUPPORTED_BROWSER';
      case VeriFaceErrorCode.unsupportedPlatform: return 'UNSUPPORTED_PLATFORM';
      case VeriFaceErrorCode.unknown: return 'UNKNOWN';
    }
  }
}

class VeriFaceException implements Exception {
  final VeriFaceErrorCode code;
  final String message;

  VeriFaceException(this.code, this.message);

  @override
  String toString() => 'VeriFaceException[${code.label}]: $message';
}
