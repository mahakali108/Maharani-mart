/**
 * Root build file: declares plugin versions from the single version catalog
 * (`gradle/libs.versions.toml`) and applies nothing globally — each module
 * opts in to exactly what it needs.
 */
plugins {
  alias(libs.plugins.android.application) apply false
  alias(libs.plugins.android.library) apply false
  alias(libs.plugins.kotlin.android) apply false
  alias(libs.plugins.kotlin.compose) apply false
  alias(libs.plugins.kotlin.serialization) apply false
  alias(libs.plugins.ksp) apply false
  alias(libs.plugins.hilt) apply false
}
