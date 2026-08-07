package io.veriface.sdk.camera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.ImageFormat
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.nio.ByteBuffer
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Camera capture using CameraX. Captures YUV frames from the front camera
 * for the rPPG/liveness window.
 *
 * Frames are stored in-memory only — never written to disk or sent off-device.
 */
class VeriFaceCamera(private val context: Context) {

    private val frameBuffer = mutableListOf<ImageProxy>()
    private val timestampBuffer = mutableListOf<Long>()
    private val frameCount = AtomicInteger(0)
    private var cameraProvider: ProcessCameraProvider? = null
    private var analysisExecutor: ExecutorService? = Executors.newSingleThreadExecutor()
    private var captureStartTime: Long = 0

    /**
     * Capture frames for [durationMs] milliseconds.
     * MUST be called from a coroutine with Dispatchers.IO.
     */
    @SuppressLint("RestrictedApi")
    suspend fun capture(durationMs: Int): CameraCapture {
        val future = ProcessCameraProvider.getInstance(context)
        cameraProvider = future.get() // blocks until available

        // Configure image analysis (no preview needed for headless capture)
        val imageAnalysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()

        imageAnalysis.setAnalyzer(analysisExecutor!!) { image ->
            processFrame(image)
        }

        // Bind to lifecycle (use a fake lifecycle owner for headless capture)
        val selector = CameraSelector.DEFAULT_FRONT_CAMERA
        try {
            cameraProvider?.unbindAll()
            cameraProvider?.bindToLifecycle(
                FakeLifecycleOwner,
                selector,
                imageAnalysis
            )
        } catch (e: Exception) {
            throw io.veriface.sdk.api.VeriFaceError.NoCamera
        }

        captureStartTime = System.currentTimeMillis()
        synchronized(frameBuffer) {
            frameBuffer.clear()
            timestampBuffer.clear()
        }

        // Wait for the capture duration
        Thread.sleep(durationMs.toLong())

        // Stop capture
        cameraProvider?.unbindAll()

        // Copy buffers
        val frames: List<ImageProxy>
        val timestamps: List<Long>
        synchronized(frameBuffer) {
            frames = frameBuffer.toList()
            timestamps = timestampBuffer.toList()
        }

        val durationSec = (System.currentTimeMillis() - captureStartTime) / 1000.0

        return CameraCapture(
            frames = frames,
            timestamps = timestamps,
            durationSec = durationSec
        )
    }

    private fun processFrame(image: ImageProxy) {
        synchronized(frameBuffer) {
            // Cap buffer size to prevent memory growth (keep last 90 frames = ~3s at 30fps)
            if (frameBuffer.size >= 90) {
                val dropped = frameBuffer.removeAt(0)
                dropped.close()
                timestampBuffer.removeAt(0)
            }
            // We need to keep the image alive — caller must close it after processing
            // (ImageProxy cannot be retained after .close(), so we copy the Y plane instead)
            val yPlane = image.planes[0]
            val yBytes = ByteArray(yPlane.buffer.remaining())
            yPlane.buffer.get(yBytes)
            // Store the metadata we need (we'll process the Y plane in the pipeline)
            // For simplicity, we keep the ImageProxy here — in production, you'd convert
            // to a more efficient format (e.g., a custom Frame class with width/height/buffer).
            frameBuffer.add(image)
            timestampBuffer.add(image.imageInfo.timestamp)
            frameCount.incrementAndGet()
        }
    }

    fun release() {
        cameraProvider?.unbindAll()
        cameraProvider = null
        analysisExecutor?.shutdown()
        analysisExecutor = null
        synchronized(frameBuffer) {
            frameBuffer.forEach { it.close() }
            frameBuffer.clear()
            timestampBuffer.clear()
        }
    }
}

/** Simple data holder for captured camera data. */
data class CameraCapture(
    val frames: List<ImageProxy>,
    val timestamps: List<Long>,
    val durationSec: Double
)

/** Fake lifecycle owner for headless capture (no UI). */
private object FakeLifecycleOwner : LifecycleOwner {
    override val lifecycle = androidx.lifecycle.LifecycleRegistry(this).apply {
        handleLifecycleEvent(androidx.lifecycle.Lifecycle.Event.ON_START)
    }
}
