package com.maharanitraders.core.network

import okhttp3.Interceptor
import okhttp3.Response

/**
 * Supplies the access token to the network layer.
 *
 * Deliberately SYNCHRONOUS and in-memory: the token is never read from disk on
 * the request path, never written to a log, and never placed in a URL. The
 * session layer (core:auth) is the only writer, and it clears the value on
 * sign-out or any 401 so a stale token cannot be reused.
 */
fun interface TokenProvider {
  fun accessToken(): String?
}

/**
 * Adds the bearer token plus the platform marker to every request.
 *
 * The app never sends cookies and never relies on a browser cookie session: identity
 * travels only in the `Authorization` header over HTTPS.
 */
class AuthInterceptor(
  private val tokenProvider: TokenProvider,
) : Interceptor {

  override fun intercept(chain: Interceptor.Chain): Response {
    val builder = chain.request()
      .newBuilder()
      .header("Accept", "application/json")
      .header("X-Platform", "android")

    bearerHeaderValue(tokenProvider.accessToken())?.let { header ->
      builder.header(AUTHORIZATION_HEADER, header)
    }

    return chain.proceed(builder.build())
  }

  companion object {
    const val AUTHORIZATION_HEADER = "Authorization"
    const val PLATFORM_HEADER = "X-Platform"

    /**
     * Pure form of the header rule, so the "blank token sends nothing" contract
     * is unit-testable without a server.
     */
    fun bearerHeaderValue(token: String?): String? =
      token?.trim()?.takeIf { it.isNotEmpty() }?.let { "Bearer $it" }
  }
}
