// VeriFace Edge — Android library build configuration
//
// Publishes a Kotlin library that uses:
//   - CameraX for camera capture
//   - ML Kit Face Detection for face landmarks
//   - BouncyCastle for Ed25519 / X25519 / AES-256-GCM / BLAKE3 / HKDF
//   - Kotlin Coroutines for async flow
//   - OkHttp for HTTP requests

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    `maven-publish`
}

android {
    namespace = "io.veriface.sdk"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    // Core Kotlin
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // CameraX
    implementation("androidx.camera:camera-core:1.3.1")
    implementation("androidx.camera:camera-camera2:1.3.1")
    implementation("androidx.camera:camera-lifecycle:1.3.1")
    implementation("androidx.camera:camera-view:1.3.1")

    // ML Kit Face Detection
    implementation("com.google.mlkit:face-detection:16.7.0")

    // Crypto (BouncyCastle for Ed25519/X25519/BLAKE3)
    implementation("org.bouncycastle:bcprov-jdk18on:1.77")

    // HTTP
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // JSON
    implementation("org.json:json:20231013")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "io.veriface"
            artifactId = "edge-sdk-android"
            version = "1.0.0"
            afterEvaluate {
                from(components["release"])
            }
            pom {
                name.set("VeriFace Edge SDK for Android")
                description.set("Privacy-first facial authentication SDK. All biometric computation runs on-device via CameraX + ML Kit.")
                url.set("https://veriface.io")
                licenses {
                    license {
                        name.set("MIT")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
            }
        }
    }
}
