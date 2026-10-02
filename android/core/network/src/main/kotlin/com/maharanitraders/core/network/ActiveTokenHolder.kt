package com.maharanitraders.core.network

import javax.inject.Inject
import javax.inject.Singleton

/**
 * The app's one in-memory access token: written by the session layer, read by
 * [AuthInterceptor].
 *
 * WHY THIS IS ITS OWN OBJECT AND NOT `SessionManager`
 * The token cannot be *derived* from the session layer. `SessionManager` needs
 * `MaharaniApi` to refresh a token and to verify a session; the API client needs
 * `OkHttpClient`; the client's interceptor needs a [TokenProvider]; and taking
 * that provider from the session layer closes the loop:
 *
 *   SessionController → TokenProvider → OkHttpClient → Retrofit → MaharaniApi
 *   → SessionManager → SessionController
 *
 * which Dagger rejects at build time (`[Dagger/DependencyCycle]`). A
 * dependency-free holder breaks the loop and keeps the property the previous
 * wiring was written for: exactly ONE copy of the token in memory, so sign-out
 * cannot leave a second copy behind.
 *
 * Deliberately synchronous and in-memory: the token is never read from disk on
 * the request path, never logged, and never placed in a URL. `@Volatile`
 * because [accessToken] is called from OkHttp's threads while the session layer
 * writes from coroutines.
 */
@Singleton
class ActiveTokenHolder @Inject constructor() : TokenProvider {

  @Volatile
  private var token: String? = null

  override fun accessToken(): String? = token

  /**
   * Publishes the token the session layer has just verified. Passing `null` is
   * equivalent to [clear].
   */
  fun set(accessToken: String?) {
    token = accessToken
  }

  /** Drops the token: sign-out, a rejected session, or a retryable refresh failure. */
  fun clear() {
    token = null
  }
}
