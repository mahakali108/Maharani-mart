import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  alias(libs.plugins.android.library)
  alias(libs.plugins.ksp)
  alias(libs.plugins.hilt)
}

android {
  namespace = "com.maharanitraders.core.auth"
  // AGP 9's new DSL expresses the SDK level as a spec. The old
  // `compileSdk = 36` assignment is a deprecated no-op there, which is
  // why AGP reported "does not specify `compileSdk`" for a file that
  // plainly set it.
  compileSdk {
    version = release(36)
  }

  defaultConfig {
    minSdk = 24
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  lint {
    abortOnError = false
  }
}

kotlin {
  compilerOptions {
    jvmTarget.set(JvmTarget.JVM_17)
  }
}

dependencies {
  implementation(project(":core:model"))
  implementation(project(":core:common"))
  implementation(project(":core:network"))

  implementation(libs.androidx.core.ktx)
  implementation(libs.kotlinx.coroutines.android)

  implementation(libs.hilt.android)
  ksp(libs.hilt.compiler)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.turbine)
  // The session tests exercise the real error mapping, which means building
  // Retrofit HttpException/Response doubles and encoding envelopes with the
  // same serializer the app uses.
  testImplementation(platform(libs.retrofit.bom))
  testImplementation(libs.retrofit)
  testImplementation(platform(libs.okhttp.bom))
  testImplementation(libs.okhttp)
  testImplementation(libs.kotlinx.serialization.json)
}
