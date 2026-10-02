import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  alias(libs.plugins.android.library)
}

android {
  namespace = "com.maharanitraders.core.model"
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
  testImplementation(libs.junit)
}
