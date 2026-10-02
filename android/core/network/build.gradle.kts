import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  alias(libs.plugins.android.library)
  alias(libs.plugins.kotlin.serialization)
  alias(libs.plugins.ksp)
  alias(libs.plugins.hilt)
}

android {
  namespace = "com.maharanitraders.core.network"
  compileSdk = 36

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

  implementation(libs.androidx.core.ktx)
  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.kotlinx.serialization.json)

  implementation(platform(libs.retrofit.bom))
  implementation(platform(libs.okhttp.bom))
  implementation(libs.retrofit)
  implementation(libs.retrofit.converter.kotlinx.serialization)
  implementation(libs.okhttp)

  implementation(libs.hilt.android)
  ksp(libs.hilt.compiler)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.turbine)
  testImplementation(libs.okhttp.mockwebserver)
  testImplementation(platform(libs.okhttp.bom))
}
