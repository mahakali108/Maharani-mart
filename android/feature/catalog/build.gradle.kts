import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  alias(libs.plugins.android.library)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.ksp)
  alias(libs.plugins.hilt)
}

// Phase D - catalogue, search and product detail.
//
// A feature module (not code in `:app`) so the catalogue can be tested without
// the shell, and so the dependency direction stays one-way:
// feature:catalog -> core:*, never the reverse.
//
// Coil is declared HERE rather than in `:app`: this is the first screen that
// renders server images, and the image loader is configured in the application
// module so a single ImageLoader instance serves the whole process.
android {
  namespace = "com.maharanitraders.feature.catalog"
  compileSdk {
    version = release(36)
  }

  defaultConfig {
    minSdk = 24
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  buildFeatures {
    compose = true
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

  lint {
    abortOnError = true
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
  implementation(project(":core:designsystem"))
  // The search/recently-viewed history is the only thing this app persists
  // locally, and it goes through the shared NON-SENSITIVE preference store
  // (`maharani_preferences`) rather than a private file of its own.
  implementation(project(":core:datastore"))

  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.graphics)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.foundation)
  implementation(libs.androidx.compose.material3)

  implementation(libs.kotlinx.coroutines.android)

  // Server product imagery. Coil 3 keeps network support in a separate
  // artifact, so the OkHttp integration is declared alongside it and installed
  // by the application module's ImageLoader factory.
  implementation(libs.coil.compose)
  implementation(libs.coil.network.okhttp)

  implementation(libs.hilt.android)
  ksp(libs.hilt.compiler)
  implementation(libs.androidx.hilt.navigation.compose)

  debugImplementation(libs.androidx.compose.ui.tooling)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.truth)
  // `ApiErrorMapper` takes a `Json`, and `:core:network` declares
  // kotlinx-serialization-json as `implementation` — which deliberately does not
  // leak to consumers — so the test source set has to ask for it directly.
  testImplementation(libs.kotlinx.serialization.json)
  // The detail tests build a real `HttpException` so the 404 path is exercised
  // through the same error mapper the app uses, rather than a hand-made error.
  testImplementation(platform(libs.retrofit.bom))
  testImplementation(libs.retrofit)
  testImplementation(platform(libs.okhttp.bom))
  testImplementation(libs.okhttp)
}
