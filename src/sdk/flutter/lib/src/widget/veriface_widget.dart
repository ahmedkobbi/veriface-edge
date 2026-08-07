// VeriFace Edge — VeriFaceWidget
//
// Drop-in widget that shows the camera preview + a capture button +
// liveness progress indicator. Wraps VeriFaceController.
//
// Usage:
//   VeriFaceWidget(
//     config: VeriFaceConfig(tenantId: '...', apiKey: '...'),
//     flow: 'authenticate',
//     externalUserId: 'user_123',
//     onSuccess: (result) => print('Token: ${result.token}'),
//     onFailure: (error) => print('Failed: $error'),
//   )

import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../api/errors.dart';
import 'veriface_controller.dart';

class VeriFaceWidget extends StatefulWidget {
  final VeriFaceConfig config;
  final String flow; // 'enroll' | 'authenticate'
  final String? externalUserId;
  final void Function(SessionVerifyResponse)? onSuccess;
  final void Function(VeriFaceException)? onFailure;
  final void Function(VeriFaceStatus)? onStatus;

  const VeriFaceWidget({
    super.key,
    required this.config,
    this.flow = 'authenticate',
    this.externalUserId,
    this.onSuccess,
    this.onFailure,
    this.onStatus,
  });

  @override
  State<VeriFaceWidget> createState() => _VeriFaceWidgetState();
}

enum VeriFaceStatus { idle, initializing, capturing, processing, success, failed }

class _VeriFaceWidgetState extends State<VeriFaceWidget> {
  late VeriFaceController _controller;
  VeriFaceStatus _status = VeriFaceStatus.idle;
  String? _errorMessage;
  SessionVerifyResponse? _result;

  @override
  void initState() {
    super.initState();
    _controller = VeriFaceController(config: widget.config);
    _initialize();
  }

  Future<void> _initialize() async {
    setState(() => _status = VeriFaceStatus.initializing);
    widget.onStatus?.call(_status);
    try {
      await _controller.initialize();
      setState(() => _status = VeriFaceStatus.idle);
      widget.onStatus?.call(_status);
    } on VeriFaceException catch (e) {
      setState(() {
        _status = VeriFaceStatus.failed;
        _errorMessage = e.message;
      });
      widget.onFailure?.call(e);
    }
  }

  Future<void> _startCapture() async {
    setState(() {
      _status = VeriFaceStatus.capturing;
      _errorMessage = null;
      _result = null;
    });
    widget.onStatus?.call(_status);

    try {
      setState(() => _status = VeriFaceStatus.processing);
      widget.onStatus?.call(_status);

      final result = await _controller.authenticate(
        externalUserId: widget.externalUserId,
      );

      setState(() {
        _result = result;
        _status = result.success ? VeriFaceStatus.success : VeriFaceStatus.failed;
        if (!result.success) {
          _errorMessage = result.error ?? 'Verification failed';
        }
      });
      widget.onStatus?.call(_status);

      if (result.success) {
        widget.onSuccess?.call(result);
      } else {
        widget.onFailure?.call(VeriFaceException(
          VeriFaceErrorCode.verificationFailed,
          result.error ?? 'Verification failed',
        ));
      }
    } on VeriFaceException catch (e) {
      setState(() {
        _status = VeriFaceStatus.failed;
        _errorMessage = e.message;
      });
      widget.onFailure?.call(e);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_status == VeriFaceStatus.initializing) {
      return _buildLoading('Initializing camera...');
    }

    if (_controller.cameraController == null ||
        !_controller.cameraController!.value.isInitialized) {
      return _buildLoading('Waiting for camera...');
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: Stack(
        children: [
          // Camera preview (mirrored for front camera)
          Transform(
            alignment: Alignment.center,
            transform: Matrix4.identity()..scale(-1.0, 1.0),
            child: CameraPreview(_controller.cameraController!),
          ),

          // Overlay UI
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                border: Border.all(
                  color: _statusBorderColor(),
                  width: 3,
                ),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),

          // Status badge
          Positioned(
            top: 12,
            left: 12,
            right: 12,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildStatusBadge(),
                if (_status == VeriFaceStatus.capturing)
                  const CircularProgressIndicator(
                    color: Colors.white,
                    strokeWidth: 2,
                  ),
              ],
            ),
          ),

          // Capture button
          if (_status == VeriFaceStatus.idle || _status == VeriFaceStatus.failed)
            Positioned(
              bottom: 24,
              left: 0,
              right: 0,
              child: Center(
                child: ElevatedButton(
                  onPressed: _startCapture,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF10b981),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 14,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(widget.flow == 'enroll' ? 'Enroll Face' : 'Verify Identity'),
                ),
              ),
            ),

          // Success overlay
          if (_status == VeriFaceStatus.success)
            Positioned.fill(
              child: Container(
                color: Colors.black54,
                child: const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.check_circle, color: Color(0xFF10b981), size: 64),
                      SizedBox(height: 12),
                      Text(
                        'Verified',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

          // Error overlay
          if (_status == VeriFaceStatus.failed && _errorMessage != null)
            Positioned(
              bottom: 80,
              left: 12,
              right: 12,
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.red.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.red, width: 1),
                ),
                child: Text(
                  _errorMessage!,
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildLoading(String message) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF0f172a),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(color: Color(0xFF10b981)),
            const SizedBox(height: 12),
            Text(
              message,
              style: const TextStyle(color: Color(0xFF94a3b8), fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusBadge() {
    final colors = {
      VeriFaceStatus.idle: Colors.grey,
      VeriFaceStatus.initializing: Colors.amber,
      VeriFaceStatus.capturing: Colors.cyan,
      VeriFaceStatus.processing: Colors.amber,
      VeriFaceStatus.success: Color(0xFF10b981),
      VeriFaceStatus.failed: Colors.red,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: colors[_status]!.withOpacity(0.2),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors[_status]!, width: 1),
      ),
      child: Text(
        _status.name.toUpperCase(),
        style: TextStyle(
          color: colors[_status],
          fontSize: 10,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  Color _statusBorderColor() {
    switch (_status) {
      case VeriFaceStatus.capturing:
        return Colors.cyan;
      case VeriFaceStatus.processing:
        return Colors.amber;
      case VeriFaceStatus.success:
        return const Color(0xFF10b981);
      case VeriFaceStatus.failed:
        return Colors.red;
      default:
        return Colors.transparent;
    }
  }
}
