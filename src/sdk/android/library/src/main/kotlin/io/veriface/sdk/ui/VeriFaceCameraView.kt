package io.veriface.sdk.ui

import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import io.veriface.sdk.api.VeriFaceConfig
import io.veriface.sdk.api.VeriFaceError
import io.veriface.sdk.api.VeriFaceFlow
import io.veriface.sdk.api.SessionVerifyResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Drop-in Compose view that shows camera preview + capture button + status. */
@Composable
fun VeriFaceCameraView(
    config: VeriFaceConfig,
    flow: VeriFaceFlow = VeriFaceFlow.AUTHENTICATE,
    externalUserId: String? = null,
    onSuccess: (SessionVerifyResponse) -> Unit,
    onFailure: (VeriFaceError) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current

    var status by remember { mutableStateOf(VeriFaceStatus.IDLE) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var hasCameraPermission by remember {
        mutableStateOf(
            context.checkSelfPermission(android.Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
        if (!granted) {
            onFailure(VeriFaceError.CameraDenied)
        }
    }

    // Request camera permission on first launch
    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(android.Manifest.permission.CAMERA)
        }
    }

    if (!hasCameraPermission) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF0F172A)),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "Camera Permission Required",
                    color = Color.White,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "VeriFace needs camera access to verify your identity.",
                    color = Color(0xFF94A3B8),
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(onClick = { permissionLauncher.launch(android.Manifest.permission.CAMERA) }) {
                    Text("Grant Permission")
                }
            }
        }
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0F172A))
    ) {
        // Camera preview (would be implemented via CameraX PreviewView)
        // For brevity, we show a placeholder — the real implementation
        // would bind a Preview use case to the lifecycleOwner.
        AndroidView(
            factory = { ctx ->
                PreviewView(ctx).apply {
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        // Status badge
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            VeriFaceStatusBadge(status = status)
            if (status == VeriFaceStatus.CAPTURING) {
                CircularProgressIndicator(
                    color = Color.White,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(20.dp)
                )
            }
        }

        // Capture button
        if (status == VeriFaceStatus.IDLE || status == VeriFaceStatus.FAILED) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.BottomCenter
            ) {
                Button(
                    onClick = {
                        scope.launch {
                            status = VeriFaceStatus.CAPTURING
                            errorMessage = null
                            try {
                                status = VeriFaceStatus.PROCESSING
                                val client = io.veriface.sdk.VeriFaceClient(context, config)
                                val result = withContext(Dispatchers.IO) {
                                    client.authenticate(externalUserId = externalUserId)
                                }
                                if (result.success) {
                                    status = VeriFaceStatus.SUCCESS
                                    onSuccess(result)
                                } else {
                                    status = VeriFaceStatus.FAILED
                                    errorMessage = result.error ?: "Verification failed"
                                    onFailure(
                                        VeriFaceError.VerificationFailed(
                                            result.errorCode ?: "UNKNOWN",
                                            result.error ?: ""
                                        )
                                    )
                                }
                            } catch (e: VeriFaceError) {
                                status = VeriFaceStatus.FAILED
                                errorMessage = e.message
                                onFailure(e)
                            } catch (e: Exception) {
                                status = VeriFaceStatus.FAILED
                                errorMessage = e.message
                                onFailure(VeriFaceError.Unknown(e.message ?: "Unknown error"))
                            }
                        }
                    },
                    modifier = Modifier
                        .padding(bottom = 32.dp)
                        .background(
                            color = Color.Transparent,
                            shape = RoundedCornerShape(12.dp)
                        ),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF10B981)
                    )
                ) {
                    Text(
                        if (flow == VeriFaceFlow.ENROLL) "Enroll Face" else "Verify Identity",
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }
            }
        }

        // Error message
        errorMessage?.let { msg ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 100.dp, start = 12.dp, end = 12.dp),
                contentAlignment = Alignment.BottomCenter
            ) {
                Surface(
                    color = Color(0x33EF4444),
                    shape = RoundedCornerShape(8.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFEF4444))
                ) {
                    Text(
                        msg,
                        color = Color.White,
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }
        }

        // Success overlay
        if (status == VeriFaceStatus.SUCCESS) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0x88000000)),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "✓",
                        color = Color(0xFF10B981),
                        fontSize = 64.sp
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Verified",
                        color = Color.White,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}

enum class VeriFaceStatus { IDLE, CAPTURING, PROCESSING, SUCCESS, FAILED }

@Composable
private fun VeriFaceStatusBadge(status: VeriFaceStatus) {
    val color = when (status) {
        VeriFaceStatus.IDLE -> Color.Gray
        VeriFaceStatus.CAPTURING -> Color.Cyan
        VeriFaceStatus.PROCESSING -> Color(0xFFF59E0B)
        VeriFaceStatus.SUCCESS -> Color(0xFF10B981)
        VeriFaceStatus.FAILED -> Color(0xFFEF4444)
    }
    Surface(
        color = color.copy(alpha = 0.2f),
        shape = RoundedCornerShape(50),
        border = androidx.compose.foundation.BorderStroke(1.dp, color)
    ) {
        Text(
            status.name,
            color = color,
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
        )
    }
}
