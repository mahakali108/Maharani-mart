import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  alias(libs.plugins.android.library)
}

android {
  namespace = "com.maharanitraders.core.model"
  // AGP 9's new DSL expresses the SDK level as a spec; it is the documented
  // replacement for the deprecated `compileSdkVersion(...)`. A CI-only error
  // once looked like a verdict on this spelling - it was not (plan doc, 1.9).
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
  testImplementation(libs.junit)
}
