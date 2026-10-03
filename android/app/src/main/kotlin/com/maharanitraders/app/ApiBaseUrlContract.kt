package com.maharanitraders.app

/**
 * Validation for the single configuration value compiled into the app
 * (`BuildConfig.API_BASE_URL`, overridable with `-PmaharaniApiBaseUrl=…`).
 *
 * Why this exists: Retrofit throws at runtime if `baseUrl` does not end in `/`,
 * and a typo such as `http://…` would silently downgrade the transport to
 * cleartext (which the release configuration forbids). Failing fast with a
 * clear message — and never falling back to a guessed host — is safer than
 * discovering it on a user's device.
 *
 * Rules enforced for EVERY build:
 *   • absolute URL;
 *   • `https` for every non-debug build; plain `http` may only be explicitly
 *     enabled for local development hosts by a debug build;
 *   • normalized to end with `/` so Retrofit resolves `api/mobile/v1/…`
 *     correctly;
 *   • rejects retired production aliases (`maharani-mart-one.vercel.app` and
 *     `maharani-mart-mahakali108s-projects.vercel.app`);
 *   • no credentials in the URL, no query string, no fragment.
 *
 * It NEVER supplies a default: an unusable value is an error, because silently
 * pointing the app at some other host would be worse.
 */
object ApiBaseUrlContract {

  sealed interface Validation {
    data class Valid(val normalized: String) : Validation
    data class Invalid(val reason: String) : Validation
  }

  /** Hosts allowed to use plain http in debug builds: loopback and emulator alias. */
  private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2", "[::1]")
  private val RETIRED_VERCEL_HOSTS = setOf(
    "maharani-mart-one.vercel.app",
    "maharani-mart-mahakali108s-projects.vercel.app",
  )

  fun validate(raw: String?, allowLocalHttp: Boolean = false): Validation {
    val value = raw?.trim().orEmpty()
    if (value.isEmpty()) return Validation.Invalid("API base URL is empty")

    val schemeSeparator = value.indexOf("://")
    if (schemeSeparator <= 0) return Validation.Invalid("API base URL must be absolute (scheme://host)")

    val scheme = value.substring(0, schemeSeparator).lowercase()
    if (scheme != "https" && scheme != "http") {
      return Validation.Invalid("API base URL must use https (found '$scheme')")
    }

    val remainder = value.substring(schemeSeparator + 3)
    if (remainder.isEmpty()) return Validation.Invalid("API base URL has no host")

    val authority = remainder.substringBefore('/')
    if (authority.isEmpty()) return Validation.Invalid("API base URL has no host")
    if (authority.contains('@')) return Validation.Invalid("API base URL must not contain credentials")
    if (authority.contains('?') || authority.contains('#')) {
      return Validation.Invalid("API base URL must not contain a query or fragment")
    }

    val host = (if (authority.startsWith("[")) {
      authority.substringBefore(']') + "]"
    } else {
      authority.substringBefore(':')
    }).lowercase()
    if (host.trimEnd('.') in RETIRED_VERCEL_HOSTS) {
      return Validation.Invalid("API base URL must not use a retired Vercel hostname")
    }
    if (scheme == "http" && (!allowLocalHttp || host !in LOCAL_HOSTS)) {
      return Validation.Invalid("Plain http is only allowed for local debug builds and development hosts")
    }

    val pathAndBeyond = remainder.substring(authority.length)
    if (pathAndBeyond.contains('?') || pathAndBeyond.contains('#')) {
      return Validation.Invalid("API base URL must not contain a query or fragment")
    }

    val normalizedPath = when {
      pathAndBeyond.isEmpty() -> "/"
      pathAndBeyond.endsWith("/") -> pathAndBeyond
      else -> "$pathAndBeyond/"
    }

    return Validation.Valid("$scheme://$authority$normalizedPath")
  }

  /**
   * Normalizes [raw] or throws with the reason. Used by the DI provider so a bad
   * build configuration fails loudly at startup instead of mid-checkout.
   */
  fun requireValid(raw: String?, allowLocalHttp: Boolean = false): String =
    when (val result = validate(raw, allowLocalHttp)) {
      is Validation.Valid -> result.normalized
      is Validation.Invalid -> error("Invalid API base URL: ${result.reason}")
    }
}
