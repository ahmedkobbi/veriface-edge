package io.veriface.sdk.pipeline.embedding

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import androidx.camera.core.ImageProxy
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.CompatibilityList
import org.tensorflow.lite.gpu.GpuDelegate
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.sqrt

/**
 * TFLite-powered face embedding generator for Android.
 *
 * Loads a TFLite model (ArcFace/MobileFaceNet) to generate 512-dim embeddings.
 * The model file should be placed in `assets/` as one of:
 *   - `arcface.tflite`
 *   - `mobilefacenet.tflite`
 *   - `face_embedding.tflite`
 *
 * Model requirements:
 *   - Input: 112x112x3 Float32 (normalized to [-1, 1])
 *   - Output: 512-dim Float32 (L2-normalized)
 *
 * If no model is bundled, falls back to a deterministic geometric embedding
 * (NOT for production — accuracy is too low for verification).
 */
class VeriFaceEmbedding(private val context: Context) {

    companion object {
        private const val INPUT_SIZE = 112
        private const val EMBEDDING_DIM = 512
        private const val PIXEL_SIZE = 3  // RGB
        private const val NORMALIZATION_MEAN = 127.5f
        private const val NORMALIZATION_STD = 127.5f

        private val MODEL_FILES = listOf(
            "arcface.tflite",
            "mobilefacenet.tflite",
            "face_embedding.tflite",
            "veriface_embedding.tflite"
        )
    }

    private var interpreter: Interpreter? = null
    private var gpuDelegate: GpuDelegate? = null

    init {
        interpreter = loadModel()
    }

    /** Whether a real TFLite model is available. */
    val isModelAvailable: Boolean
        get() = interpreter != null

    /** Face embedding result. */
    data class Result(
        val embedding: FloatArray,
        val quality: Double,
        val usedModel: Boolean
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is Result) return false
            return embedding.contentEquals(other.embedding)
        }
        override fun hashCode(): Int = embedding.contentHashCode()
    }

    /** Generate a 512-dim embedding from a face crop. */
    fun generateEmbedding(image: ImageProxy, faceBounds: Rect): Result {
        val interp = interpreter
        if (interp == null) {
            return Result(generateFallbackEmbedding(), 0.3, false)
        }

        // 1. Crop + resize the face region to 112x112
        val faceBitmap = cropAndResizeFace(image, faceBounds)
            ?: return Result(generateFallbackEmbedding(), 0.2, false)

        // 2. Convert bitmap to normalized Float32 input buffer
        val inputBuffer = bitmapToNormalizedBuffer(faceBitmap)

        // 3. Prepare output buffer
        val outputBuffer = FloatBuffer.allocate(EMBEDDING_DIM)

        // 4. Run inference
        try {
            interp!!.run(inputBuffer, outputBuffer)
            outputBuffer.rewind()

            // 5. Extract embedding
            val embedding = FloatArray(EMBEDDING_DIM)
            outputBuffer.get(embedding)

            // 6. L2 normalize
            val normalized = l2Normalize(embedding)

            // 7. Compute quality
            val quality = computeQuality(embedding)

            return Result(normalized, quality, true)
        } catch (e: Exception) {
            android.util.Log.w("VeriFaceEmbedding", "TFLite inference failed: ${e.message}")
            return Result(generateFallbackEmbedding(), 0.3, false)
        }
    }

    /** Release the TFLite interpreter + GPU delegate. */
    fun close() {
        interpreter?.close()
        interpreter = null
        gpuDelegate?.close()
        gpuDelegate = null
    }

    // MARK: - Model loading

    private fun loadModel(): Interpreter? {
        for (fileName in MODEL_FILES) {
            try {
                val assetManager = context.assets
                val fileDescriptor = assetManager.openFd(fileName)
                val inputStream = FileInputStream(fileDescriptor.fileDescriptor)
                val fileChannel = inputStream.channel
                val startOffset = fileDescriptor.startOffset
                val declaredLength = fileDescriptor.declaredLength
                val mappedBuffer: MappedByteBuffer = fileChannel.map(
                    FileChannel.MapMode.READ_ONLY,
                    startOffset,
                    declaredLength
                )
                inputStream.close()

                // Configure interpreter options
                val options = Interpreter.Options()
                // Try GPU delegation for faster inference
                try {
                    if (CompatibilityList().isDelegateSupportedOnThisDevice) {
                        gpuDelegate = GpuDelegate()
                        options.addDelegate(gpuDelegate)
                        android.util.Log.i("VeriFaceEmbedding", "Using GPU delegate for $fileName")
                    } else {
                        options.setNumThreads(4)
                        android.util.Log.i("VeriFaceEmbedding", "Using CPU (4 threads) for $fileName")
                    }
                } catch (e: Exception) {
                    options.setNumThreads(4)
                    android.util.Log.i("VeriFaceEmbedding", "GPU delegate failed, using CPU: ${e.message}")
                }

                val interp = Interpreter(mappedBuffer, options)
                android.util.Log.i("VeriFaceEmbedding", "Loaded TFLite model: $fileName")
                return interp
            } catch (e: java.io.FileNotFoundException) {
                // Try next file name
                continue
            } catch (e: Exception) {
                android.util.Log.w("VeriFaceEmbedding", "Failed to load $fileName: ${e.message}")
            }
        }

        android.util.Log.w("VeriFaceEmbedding", "No TFLite model found — using fallback (NOT production-ready)")
        return null
    }

    // MARK: - Face cropping

    private fun cropAndResizeFace(image: ImageProxy, faceBounds: Rect): Bitmap? {
        // Convert ImageProxy (YUV) to Bitmap
        val fullBitmap = imageProxyToBitmap(image) ?: return null

        // Expand crop slightly (ArcFace expects some context)
        val expandX = faceBounds.width() / 10
        val expandY = faceBounds.height() / 10
        val srcRect = Rect(
            maxOf(0, faceBounds.left - expandX),
            maxOf(0, faceBounds.top - expandY),
            minOf(fullBitmap.width, faceBounds.right + expandX),
            minOf(fullBitmap.height, faceBounds.bottom + expandY)
        )

        // Create 112x112 output bitmap
        val outputBitmap = Bitmap.createBitmap(INPUT_SIZE, INPUT_SIZE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(outputBitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        val dstRect = RectF(0f, 0f, INPUT_SIZE.toFloat(), INPUT_SIZE.toFloat())
        canvas.drawBitmap(fullBitmap, srcRect, dstRect, paint)

        return outputBitmap
    }

    /** Convert YUV_420_888 ImageProxy to Bitmap (slow — for production, use Renderscript or native). */
    private fun imageProxyToBitmap(image: ImageProxy): Bitmap? {
        if (image.format != android.graphics.ImageFormat.YUV_420_888) return null

        val width = image.width
        val height = image.height
        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer

        val yRowStride = yPlane.rowStride
        val uRowStride = uPlane.rowStride
        val uPixelStride = uPlane.pixelStride
        val vRowStride = vPlane.rowStride
        val vPixelStride = vPlane.pixelStride

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)

        for (row in 0 until height) {
            for (col in 0 until width) {
                val yIndex = row * yRowStride + col
                val yVal = yBuffer.get(yIndex).toInt() and 0xFF

                val uvRow = row / 2
                val uvCol = col / 2
                val uIndex = uvRow * uRowStride + uvCol * uPixelStride
                val vIndex = uvRow * vRowStride + uvCol * vPixelStride
                val uVal = uBuffer.get(uIndex).toInt() and 0xFF
                val vVal = vBuffer.get(vIndex).toInt() and 0xFF

                // YUV to RGB (BT.601)
                val r = (yVal + 1.402 * (vVal - 128)).coerceIn(0.0, 255.0).toInt()
                val g = (yVal - 0.344 * (uVal - 128) - 0.714 * (vVal - 128)).coerceIn(0.0, 255.0).toInt()
                val b = (yVal + 1.772 * (uVal - 128)).coerceIn(0.0, 255.0).toInt()

                bitmap.setPixel(col, row, Color.rgb(r, g, b))
            }
        }

        return bitmap
    }

    // MARK: - Normalization

    /** Convert Bitmap to normalized Float32 ByteBuffer ([-1, 1] range). */
    private fun bitmapToNormalizedBuffer(bitmap: Bitmap): ByteBuffer {
        val batchNum = 1
        val inputSize = INPUT_SIZE * INPUT_SIZE * PIXEL_SIZE * batchNum * 4  // 4 bytes per Float32
        val buffer = ByteBuffer.allocateDirect(inputSize)
        buffer.order(ByteOrder.nativeOrder())

        val intValues = IntArray(INPUT_SIZE * INPUT_SIZE)
        bitmap.getPixels(intValues, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)

        var pixel = 0
        for (i in intValues) {
            // Extract RGB
            val r = Color.red(i)
            val g = Color.green(i)
            val b = Color.blue(i)

            // Normalize to [-1, 1]: (value - 127.5) / 127.5
            buffer.putFloat((r - NORMALIZATION_MEAN) / NORMALIZATION_STD)
            buffer.putFloat((g - NORMALIZATION_MEAN) / NORMALIZATION_STD)
            buffer.putFloat((b - NORMALIZATION_MEAN) / NORMALIZATION_STD)
            pixel++
        }

        buffer.rewind()
        return buffer
    }

    private fun l2Normalize(embedding: FloatArray): FloatArray {
        var sumSq = 0.0f
        for (v in embedding) sumSq += v * v
        val norm = sqrt(sumSq)
        return if (norm > 0) {
            FloatArray(embedding.size) { embedding[it] / norm }
        } else {
            embedding
        }
    }

    private fun computeQuality(embedding: FloatArray): Double {
        var sumSq = 0.0f
        for (v in embedding) sumSq += v * v
        val norm = sqrt(sumSq)
        return minOf(1.0, norm.toDouble() / 10.0)
    }

    private fun generateFallbackEmbedding(): FloatArray {
        return FloatArray(EMBEDDING_DIM) { i ->
            (Math.sin(i * 0.1) * 0.5 + 0.5).toFloat()
        }
    }
}
