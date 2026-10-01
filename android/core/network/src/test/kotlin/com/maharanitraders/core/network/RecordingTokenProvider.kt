package com.maharanitraders.core.network

/**
 * Test double for the in-memory token holder.
 * `null` models a signed-out app; a value models an active session.
 */
class RecordingTokenProvider(private val token: String?) : TokenProvider {
  override fun accessToken(): String? = token
}
