import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  alias(libs.plugins.android.library)
}

android {
  namespace = "com.maharanitraders.core.model"
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
  testImplementation(libs.junit)
}
