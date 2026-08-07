# VeriFace Edge SDK — Consumer ProGuard rules
#
# These rules are applied to apps that depend on this library.

# BouncyCastle (crypto)
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# ML Kit
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# CameraX
-keep class androidx.camera.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# VeriFace SDK
-keep class io.veriface.sdk.** { *; }
-keepclassmembers class io.veriface.sdk.** { *; }
