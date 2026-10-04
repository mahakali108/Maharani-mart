/**
 * Maharani Traders — native Android application.
 *
 * Module graph (see docs/NATIVE_ANDROID_MIGRATION_PLAN.md §2):
 *   app                       application module: manifest, DI graph, navigation shell
 *   core/common               dispatchers, typed errors/results, connectivity, policies
 *   core/model                domain types shared by every layer (roles, session, API error codes)
 *   core/network              Retrofit/OkHttp/kotlinx-serialization, interceptors, error mapping
 *   core/auth                 session lifecycle + Keystore-backed token storage
 *   core/datastore            DataStore for NON-SENSITIVE preferences only
 *   core/designsystem         Material 3 theme (brand tokens), state surfaces, money formatting
 *
 * Feature modules are added one per migration phase, each together with the API
 * endpoints it needs — never as empty scaffolding. Phase C adds :feature:auth,
 * Phase D adds :feature:catalog (with its /api/mobile/v1/catalog endpoints).
 */
pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "MaharaniTraders"

include(":app")
include(":core:common")
include(":core:model")
include(":core:network")
include(":core:auth")
include(":core:datastore")
include(":core:designsystem")
include(":feature:auth")
include(":feature:catalog")
include(":feature:orders")
