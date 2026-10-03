import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.ksp)
  alias(libs.plugins.hilt)
}

// API base URL - the ONLY compiled-in configuration value.
//
// It is not a secret: no Supabase URL, anon key, service-role key or provider
// credential is ever shipped in the APK (all authentication is proxied through
// /api/mobile/v1/auth/…, see docs/NATIVE_ANDROID_API_CONTRACT.md).
//
// Override per build without editing this file:
//   ./gradlew assembleDebug -PmaharaniApiBaseUrl=https://staging.example/
val maharaniApiBaseUrl: String =
  (project.findProperty("maharaniApiBaseUrl") as String?)
    ?: "https://maharanitraders.vercel.app/"

// Release signing is read from the environment ONLY - never from the repo.
val releaseStorePath: String? = System.getenv("RELEASE_KEYSTORE_PATH")
val releaseStorePassword: String? = System.getenv("RELEASE_KEYSTORE_PASSWORD")
val releaseKeyAlias: String? = System.getenv("RELEASE_KEY_ALIAS")
val releaseKeyPassword: String? = System.getenv("RELEASE_KEY_PASSWORD")
val releaseSigningConfigured: Boolean =
  listOf(releaseStorePath, releaseStorePassword, releaseKeyAlias, releaseKeyPassword)
    .all { !it.isNullOrBlank() }

android {
  namespace = "com.maharanitraders.app"
  // AGP 9 expresses the SDK level as a spec; `compileSdk = 36` also works.
  // Neither form was ever the problem - see docs/ANDROID_IMPLEMENTATION_PLAN.md
  // section 1.9.
  compileSdk {
    version = release(36)
  }

  defaultConfig {
    applicationId = "com.maharanitraders.app"
    minSdk = 24
    targetSdk = 36
    versionCode = 1
    // Phase B foundation build — not a store release. See docs/NATIVE_ANDROID_MIGRATION_PLAN.md §9.
    versionName = "1.0.0-phase-b"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    vectorDrawables { useSupportLibrary = true }
  }

  if (releaseSigningConfigured) {
    signingConfigs {
      create("release") {
        storeFile = file(releaseStorePath!!)
        storePassword = releaseStorePassword
        keyAlias = releaseKeyAlias
        keyPassword = releaseKeyPassword
      }
    }
  }

  buildTypes {
    debug {
      // Local/staging override; the default is the deployed HTTPS API.
      buildConfigField("String", "API_BASE_URL", "\"$maharaniApiBaseUrl\"")
      isMinifyEnabled = false
    }
    release {
      buildConfigField("String", "API_BASE_URL", "\"$maharaniApiBaseUrl\"")
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro",
      )
      if (releaseSigningConfigured) {
        signingConfig = signingConfigs.getByName("release")
      }
    }
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  testOptions {
    unitTests {
      isIncludeAndroidResources = true
      isReturnDefaultValues = true
    }
  }

  packaging {
    resources {
      excludes += listOf(
        "DebugProbesKt.bin",
        "kotlin-tooling-metadata.json",
        // Built as concatenation so the file contains no comment-opening
        // sequence at all.
        "kotlin/" + "**",
        "META-INF/*.kotlin_module",
      )
    }
  }

  lint {
    // Phase B: lint RUNS in CI and reports, but does not fail the build while the
    // shell is still being built out. Flipped to abortOnError = true in Phase H
    // (docs/NATIVE_ANDROID_MIGRATION_PLAN.md §5).
    abortOnError = false
    warningsAsErrors = false
    disable += listOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable")
  }
}


kotlin {
  compilerOptions {
    jvmTarget.set(JvmTarget.JVM_17)
  }
}

dependencies {
  implementation(project(":core:common"))
  implementation(project(":core:model"))
  implementation(project(":core:network"))
  implementation(project(":core:auth"))
  implementation(project(":core:datastore"))
  implementation(project(":core:designsystem"))
  implementation(project(":feature:auth"))

  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.core.splashscreen)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)
  implementation(libs.androidx.activity.compose)
  implementation(libs.androidx.navigation.compose)
  implementation(libs.androidx.hilt.navigation.compose)

  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.graphics)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.foundation)
  implementation(libs.androidx.compose.material3)

  implementation(libs.kotlinx.coroutines.android)

  implementation(libs.hilt.android)
  ksp(libs.hilt.compiler)

  debugImplementation(libs.androidx.compose.ui.tooling)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.turbine)
  testImplementation(libs.androidx.test.core)
  testImplementation(libs.truth)
  // The base-URL test resolves endpoints with OkHttp's own URL parser — the
  // same implementation Retrofit uses — so the test cannot disagree with the
  // runtime about how a path is joined.
  testImplementation(platform(libs.okhttp.bom))
  testImplementation(libs.okhttp)

  androidTestImplementation(libs.androidx.test.junit)
  androidTestImplementation(libs.androidx.test.espresso)
}
