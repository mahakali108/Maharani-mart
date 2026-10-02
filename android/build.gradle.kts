/**
 * Root build file: declares plugin versions from the single version catalog
 * (`gradle/libs.versions.toml`) and applies nothing globally — each module
 * opts in to exactly what it needs.
 */
// AGP 9's built-in Kotlin has a runtime dependency on KGP 2.2.10, while the
// Compose compiler plugin and the serialization plugin are KGP plugins that must
// match the Kotlin compiler exactly. Raising KGP explicitly is the documented
// way to run built-in Kotlin on a newer Kotlin:
// https://developer.android.com/build/releases/agp-9-0-0-release-notes
// The version must match `kotlin` in gradle/libs.versions.toml — asserted by
// tests/android-project-integrity.test.ts.
buildscript {
  dependencies {
    classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.20")
  }
}

plugins {
  alias(libs.plugins.android.application) apply false
  alias(libs.plugins.android.library) apply false
  alias(libs.plugins.kotlin.compose) apply false
  alias(libs.plugins.kotlin.serialization) apply false
  alias(libs.plugins.ksp) apply false
  alias(libs.plugins.hilt) apply false
}
