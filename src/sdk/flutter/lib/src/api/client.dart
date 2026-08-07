// VeriFace Edge — API client (Dart)
//
// Wraps the /api/session/init and /api/session/verify endpoints.
// The SDK signs the verify payload with Ed25519 before sending.

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'types.dart';
import 'errors.dart';

class VeriFaceClient {
  final VeriFaceConfig config;

  VeriFaceClient(this.config);

  /// Initialize a session. Returns the challenge + backend's ephemeral
  /// X25519 public key for ECDH key agreement.
  Future<SessionInitResponse> initSession({
    required String flow,
    String? externalUserId,
  }) async {
    final url = Uri.parse('${config.apiBaseUrl}/api/session/init');
    final res = await http.post(
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${config.apiKey}',
      },
      body: jsonEncode({
        'tenantId': config.tenantId,
        'flow': flow,
        if (externalUserId != null) 'externalUserId': externalUserId,
      }),
    );

    if (res.statusCode != 200) {
      throw VeriFaceException(
        VeriFaceErrorCode.networkError,
        'Session init failed: HTTP ${res.statusCode}',
      );
    }

    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (body['success'] != true) {
      throw VeriFaceException(
        VeriFaceErrorCode.networkError,
        body['error'] as String? ?? 'Session init failed',
      );
    }

    return SessionInitResponse.fromJson(body);
  }

  /// Submit the signed + encrypted verification payload.
  Future<SessionVerifyResponse> verifySession({
    required SessionVerifyPayload payload,
  }) async {
    final url = Uri.parse('${config.apiBaseUrl}/api/session/verify');
    final res = await http.post(
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${config.apiKey}',
        'X-VeriFace-Timestamp': DateTime.now().millisecondsSinceEpoch.toString(),
        'X-VeriFace-Nonce': _generateNonce(),
      },
      body: jsonEncode(payload.toJson()),
    );

    if (res.statusCode != 200 && res.statusCode != 401 && res.statusCode != 403) {
      throw VeriFaceException(
        VeriFaceErrorCode.networkError,
        'Verify failed: HTTP ${res.statusCode}',
      );
    }

    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return SessionVerifyResponse.fromJson(body);
  }

  String _generateNonce() {
    // Simple nonce — in production use a cryptographically secure RNG
    return DateTime.now().microsecondsSinceEpoch.toRadixString(16);
  }
}
