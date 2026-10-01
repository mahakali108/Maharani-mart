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
 *   • `https`, except plain-`http` local development hosts (loopback and the
 *     Android emulator host alias), which the debug network security config
 *     permits and the release config does not;
 *   • normalized to end with `/` so Retrofit resolves `api/mobile/v1/…`
 *     correctly;
 *   • no credentials in the URL, no query string, no fragment.
 *
 * It NEVER supplies a default: an unusable value is an error, because silently
 * pointing the app at some other host would be worse than failing.
 */
object ApiBaseUrlContract {

  sealed interface Validation {
    data class Valid(val normalized: String) : Validation
    data class Invalid(val reason: String) : Validation
  }

  /** Hosts allowed to use plain http: the emulator loopback alias and localhost. */
  private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2", "[::1]")

  fun validate(raw: String?): Validation {
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

    val host = authority.substringBefore(':').lowercase()
    if (scheme == "http" && host !in LOCAL_HOSTS) {
      return Validation.Invalid("Plain http is only allowed for local development hosts")
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
  fun requireValid(raw: String?): String = when (val result = validate(raw)) {
    is Validation.Valid -> result.normalized
    is Validation.Invalid -> error("Invalid API base URL: ${result.reason}")
  }
}
