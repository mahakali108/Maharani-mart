package com.maharanitraders.app

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The API base URL is the only value compiled into the app, so it gets the
 * strictest test in the shell:
 *   • the value actually baked into this build must be usable, https, and end
 *     with `/` (Retrofit throws otherwise);
 *   • the URL that Retrofit would produce for the Phase B endpoints must be the
 *     real `/api/mobile/v1/...` path;
 *   • cleartext is allowed only when a debug build explicitly enables local
 *     development hosts; credentials, query strings and fragments are rejected.
 */
class ApiBaseUrlContractTest {

  @Test
  fun `the compiled-in base url is valid, https and normalised`() {
    val raw = BuildConfig.API_BASE_URL
    val validated = ApiBaseUrlContract.validate(raw, allowLocalHttp = BuildConfig.DEBUG)

    assertTrue("expected a valid base url, got $validated", validated is ApiBaseUrlContract.Validation.Valid)
    val normalized = (validated as ApiBaseUrlContract.Validation.Valid).normalized
    assertTrue(normalized.startsWith("https://"))
    assertTrue(normalized.endsWith("/"))
    assertTrue("base url must not carry credentials or a query", !normalized.contains('@'))
  }

  @Test
  fun `retrofit resolves the phase b endpoints against the compiled-in base url`() {
    val base = ApiBaseUrlContract.requireValid(
      BuildConfig.API_BASE_URL,
      allowLocalHttp = BuildConfig.DEBUG,
    ).toHttpUrl()

    // Same resolution rule Retrofit applies to `@GET("api/mobile/v1/session")`.
    assertEquals(
      "/api/mobile/v1/session",
      base.resolve("api/mobile/v1/session")!!.encodedPath,
    )
    assertEquals(
      "/api/mobile/v1/health",
      base.resolve("api/mobile/v1/health")!!.encodedPath,
    )
    assertEquals(base.host, base.resolve("api/mobile/v1/session")!!.host)
    assertEquals("https", base.resolve("api/mobile/v1/session")!!.scheme)
  }

  @Test
  fun `normalises a missing trailing slash`() {
    val result = ApiBaseUrlContract.validate("https://maharani.example.com")
    assertEquals(
      ApiBaseUrlContract.Validation.Valid("https://maharani.example.com/"),
      result,
    )
  }

  @Test
  fun `keeps an explicit base path`() {
    val result = ApiBaseUrlContract.validate("https://maharani.example.com/app")
    assertEquals(
      ApiBaseUrlContract.Validation.Valid("https://maharani.example.com/app/"),
      result,
    )
  }

  @Test
  fun `allows plain http only for explicitly enabled local debug hosts`() {
    listOf(
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://10.0.2.2:3000",
    ).forEach { local ->
      val result = ApiBaseUrlContract.validate(local, allowLocalHttp = true)
      assertTrue(
        "expected $local to be allowed in debug development",
        result is ApiBaseUrlContract.Validation.Valid,
      )
    }

    // The release/default path rejects even loopback cleartext.
    val releaseLocal = ApiBaseUrlContract.validate("http://localhost:3000")
    assertTrue(releaseLocal is ApiBaseUrlContract.Validation.Invalid)

    // A public host over cleartext is rejected even if local development is enabled.
    val remote = ApiBaseUrlContract.validate("http://maharani.example.com", allowLocalHttp = true)
    assertTrue(remote is ApiBaseUrlContract.Validation.Invalid)
  }

  @Test
  fun `rejects anything that is not an absolute https url by default`() {
    val rejected = listOf(
      "",
      "   ",
      "maharani.example.com",
      "ftp://maharani.example.com",
      "http://localhost:3000",
      "https://",
      "https://user:secret@maharani.example.com/",
      "https://maharani.example.com/?token=abc",
      "https://maharani.example.com?token=abc",
      "https://maharani.example.com/#fragment",
      "https://maharani.example.com#fragment",
    )

    rejected.forEach { raw ->
      val result = ApiBaseUrlContract.validate(raw)
      assertTrue(
        "expected '$raw' to be rejected, got $result",
        result is ApiBaseUrlContract.Validation.Invalid,
      )
    }
  }

  @Test
  fun `requireValid throws with the reason instead of guessing a host`() {
    val error = runCatching { ApiBaseUrlContract.requireValid("http://maharani.example.com") }
      .exceptionOrNull()

    assertTrue(error is IllegalStateException)
    assertTrue(error!!.message!!.contains("Plain http"))
  }

  @Test
  fun `never embeds the database project url in the client`() {
    // The app talks to the Next.js backend only; the datastore project URL is
    // not part of the compiled configuration.
    assertTrue(!BuildConfig.API_BASE_URL.contains("supabase"))
  }
}
