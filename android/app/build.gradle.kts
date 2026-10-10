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

if (!releaseSigningConfigured) {
  // Said out loud on every build so an unsigned artifact can never be mistaken
  // for a distributable one. The message names the variables, never a value.
  logger.lifecycle(
    "Maharani release signing is NOT configured - set RELEASE_KEYSTORE_PATH, " +
      "RELEASE_KEYSTORE_PASSWORD, RELEASE_KEY_ALIAS and RELEASE_KEY_PASSWORD. " +
      "The release artifact will stay UNSIGNED and must not be given to a retailer. " +
      "See docs/ANDROID_RELEASE_SIGNING.md.",
  )
}

// ---------------------------------------------------------------------------
// Release version - android/version.properties is the single source of truth.
// ---------------------------------------------------------------------------
//
// versionName and versionCode are DERIVED from that file so they can never
// disagree, and there is deliberately no way to hand-write a versionName here:
// the literal this block replaced still read "1.0.0-phase-b" long after Phase B
// ended, and a pre-release marker on a shopkeeper's phone is how a test build
// gets mistaken for a launch build (docs/ANDROID_RELEASE_CHECKLIST.md §1).
//
// The file is read through the provider API so the configuration cache tracks it
// as a real build input; a bare File.readText() would be an untracked implicit
// dependency and could serve a stale version from cache.
//
// A missing or malformed file FAILS THE BUILD with the reason, rather than
// falling back to a default - silently shipping versionCode 1 twice would make
// every installed device refuse the update.
val maharaniVersionText: String = providers
  .fileContents(rootProject.layout.projectDirectory.file("version.properties"))
  .asText
  .orNull
  ?: throw GradleException(
    "android/version.properties is missing. It is the single source of truth for " +
      "versionName and versionCode - restore it before building.",
  )

// Parsed with the Kotlin standard library ONLY - no java.util.Properties.
//
// That is not a style choice. In a Gradle Kotlin DSL script the simple name
// `java` resolves to the project's `java` EXTENSION, which shadows the `java`
// package root, so `java.util.Properties` fails to compile with
// "Unresolved reference 'util'" (CI run 37957848482 proved it). An explicit
// `import java.util.Properties` would work, but this parser needs nothing that
// Properties provides: the file is KEY=VALUE lines with `#` comments, and having
// no JDK type here keeps the script free of any name the build could shadow.
//
// The semantics match tests/android-release-versioning.test.ts, which parses the
// same file the same way and asserts the values CI reads back out of the APK.
val maharaniVersionValues: Map<String, String> = maharaniVersionText
  .lineSequence()
  .map { it.trim() }
  .filter { it.isNotEmpty() && !it.startsWith("#") && !it.startsWith("!") }
  .filter { it.contains('=') }
  .associate { line ->
    val separator = line.indexOf('=')
    line.substring(0, separator).trim() to line.substring(separator + 1).trim()
  }

fun maharaniVersionInt(key: String, minimum: Int): Int {
  val raw = maharaniVersionValues[key]
    ?: throw GradleException("android/version.properties must define $key")
  val parsed = raw.toIntOrNull()
    ?: throw GradleException("android/version.properties: $key must be a plain integer, found '$raw'")
  if (parsed < minimum) {
    throw GradleException("android/version.properties: $key must be >= $minimum, found $parsed")
  }
  return parsed
}

val maharaniVersionCode: Int = maharaniVersionInt("VERSION_CODE", 1)
val maharaniVersionName: String =
  listOf(
    maharaniVersionInt("VERSION_MAJOR", 0),
    maharaniVersionInt("VERSION_MINOR", 0),
    maharaniVersionInt("VERSION_PATCH", 0),
  ).joinToString(".")

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
    versionCode = maharaniVersionCode
    // Derived from android/version.properties as MAJOR.MINOR.PATCH - never a
    // hand-written literal, and never carrying a pre-release suffix.
    versionName = maharaniVersionName
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
        // License/notice stubs duplicated from every upstream artifact — pure
        // documentation, never read on-device. META-INF/services is NOT
        // excluded (ServiceLoader lookups), nor anything else reflective.
        "META-INF/LICENSE*",
        "META-INF/NOTICE*",
        "META-INF/DEPENDENCIES",
        "META-INF/AL2.0",
        "META-INF/LGPL2.1",
        "META-INF/INDEX.LIST",
      )
    }
  }

  lint {
    // Acceptance gate: actual lint errors must fail CI.
    abortOnError = true
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
  implementation(project(":feature:catalog"))
  implementation(project(":feature:orders"))
  implementation(project(":feature:engagement"))

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

  // One image loader serves the whole process. Coil 3 keeps network support in
  // a separate artifact, so it is declared where the loader is BUILT (here) as
  // well as where images are drawn (:feature:catalog).
  implementation(libs.coil.compose)
  implementation(libs.coil.network.okhttp)

  implementation(libs.hilt.android)
  ksp(libs.hilt.compiler)

  debugImplementation(libs.androidx.compose.ui.tooling)

  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.turbine)
  testImplementation(libs.truth)
  // The base-URL test resolves endpoints with OkHttp's own URL parser — the
  // same implementation Retrofit uses — so the test cannot disagree with the
  // runtime about how a path is joined.
  testImplementation(platform(libs.okhttp.bom))
  testImplementation(libs.okhttp)

  // No androidTestImplementation dependencies: the project ships unit tests
  // only, and the 2026-10 size audit removed the unused androidx.test:core /
  // androidx.test.ext:junit / espresso-core scaffolding (no androidTest source
  // set exists anywhere). Re-add them WITH the first instrumented test —
  // test-only artifacts never reach the APK either way.
}

// Rendered Compose regressions run only in the JVM test APK/environment.
dependencies {
  testImplementation("org.robolectric:robolectric:4.16.1")
  testImplementation("androidx.compose.ui:ui-test-junit4:1.10.3")
  debugImplementation("androidx.compose.ui:ui-test-manifest:1.10.3")
}
