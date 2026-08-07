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
    id("org.jetbrains.dokka") version "1.9.10"
    signing
}

android {
    namespace = "io.veriface.sdk"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Sign release builds for Maven Central
            // (Signing config is set via environment variables in CI)
        }
        debug {
            isDebuggable = true
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
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
            withJavadocJar()
        }
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

    // TFLite for face embedding (replaces placeholder)
    implementation("org.tensorflow:tensorflow-lite:2.16.1")
    implementation("org.tensorflow:tensorflow-lite-support:0.4.4")
    implementation("org.tensorflow:tensorflow-lite-gpu:2.16.1")

    // Crypto (BouncyCastle for Ed25519/X25519/BLAKE3)
    implementation("org.bouncycastle:bcprov-jdk18on:1.77")

    // HTTP (with certificate pinning support)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:certificatepinner:4.12.0")

    // JSON
    implementation("org.json:json:20231013")

    // AndroidX Security (for encrypted shared preferences — secure key storage)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("org.mockito:mockito-core:5.10.0")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.2.1")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}

// ---------------------------------------------------------------------------
// Maven Central publishing configuration
// ---------------------------------------------------------------------------

val mavenGroupId = "io.veriface"
val mavenArtifactId = "edge-sdk-android"
val mavenVersion = "1.0.0"

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = mavenGroupId
            artifactId = mavenArtifactId
            version = mavenVersion

            afterEvaluate {
                from(components["release"])
            }

            pom {
                name.set("VeriFace Edge SDK for Android")
                description.set("Privacy-first facial authentication SDK. All biometric computation runs on-device via CameraX + ML Kit + TFLite. Zero-knowledge Pedersen commitments, Ed25519/X25519/AES-256-GCM/BLAKE3 crypto, 6-layer anti-injection defense.")
                url.set("https://github.com/ahmedkobbi/veriface-edge")
                inceptionYear.set("2026")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        id.set("ahmedkobbi")
                        name.set("ahmedkobbi")
                        email.set("ahmedkobbi@users.noreply.github.com")
                        url.set("https://github.com/ahmedkobbi")
                    }
                }
                scm {
                    url.set("https://github.com/ahmedkobbi/veriface-edge")
                    connection.set("scm:git:git://github.com/ahmedkobbi/veriface-edge.git")
                    developerConnection.set("scm:git:ssh://github.com/ahmedkobbi/veriface-edge.git")
                }
                issueManagement {
                    system.set("GitHub")
                    url.set("https://github.com/ahmedkobbi/veriface-edge/issues")
                }
            }
        }
    }

    repositories {
        maven {
            name = "MavenCentralPortal"
            url = uri("https://central.sonatype.com/repository/maven-snapshots/")
            credentials {
                username = System.getenv("MAVEN_USERNAME") ?: ""
                password = System.getenv("MAVEN_PASSWORD") ?: ""
            }
        }
    }
}

// ---------------------------------------------------------------------------
// GPG signing for Maven Central
// ---------------------------------------------------------------------------

signing {
    useInMemoryPgpKeys(
        System.getenv("MAVEN_GPG_KEY_ID"),
        System.getenv("MAVEN_GPG_KEY"),
        System.getenv("MAVEN_GPG_PASSPHRASE"),
    )
    sign(publishing.publications["release"])
}

// ---------------------------------------------------------------------------
// Dokka — Javadoc generation
// ---------------------------------------------------------------------------

tasks.withType<org.jetbrains.dokka.gradle.DokkaTask> {
    outputDirectory.set(file("$buildDir/javadoc"))
    dokkaSourceSets {
        named("main") {
            moduleName.set("VeriFace Edge Android SDK")
            moduleVersion.set(mavenVersion)
            includes.from("README.md")
        }
    }
}
