package com.maharanitraders.core.auth

import com.maharanitraders.core.model.SessionTokens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The encrypted session file's plaintext format.
 *
 * These tests matter because the format decides whether a stored session is
 * still usable after an app update: it must round-trip exactly, and anything
 * unexpected must be rejected rather than partially restored.
 *
 * (The Android Keystore half of [KeystoreTokenStore] needs a device or
 * Robolectric and is covered by the instrumented plan in Phase H.)
 */
class TokenPayloadCodecTest {

  private val tokens = SessionTokens(
    accessToken = "eyJhbGciOiJIUzI1NiJ9.ACCESS.signature",
    refreshToken = "v1-refresh-token",
    expiresAtEpochSeconds = 1_800_000_000,
  )

  @Test
  fun `round-trips every field`() {
    val restored = TokenPayloadCodec.parse(TokenPayloadCodec.serialize(tokens))
    assertEquals(tokens, restored)
  }

  @Test
  fun `writes the documented version tag`() {
    assertEquals(
      "v1|eyJhbGciOiJIUzI1NiJ9.ACCESS.signature|v1-refresh-token|1800000000",
      TokenPayloadCodec.serialize(tokens),
    )
  }

  @Test
  fun `rejects a payload from an unknown format version`() {
    assertNull(TokenPayloadCodec.parse("v2|access|refresh|1800000000"))
    assertNull(TokenPayloadCodec.parse("access|refresh|1800000000"))
  }

  @Test
  fun `rejects missing or extra fields instead of guessing`() {
    assertNull(TokenPayloadCodec.parse("v1|access|refresh"))
    assertNull(TokenPayloadCodec.parse("v1|access|refresh|1800000000|extra"))
    assertNull(TokenPayloadCodec.parse("v1||refresh|1800000000"))
    assertNull(TokenPayloadCodec.parse("v1|access||1800000000"))
    assertNull(TokenPayloadCodec.parse("v1|access|refresh|not-a-number"))
    assertNull(TokenPayloadCodec.parse(""))
  }

  @Test
  fun `keeps large epoch values exact`() {
    val farFuture = tokens.copy(expiresAtEpochSeconds = 4_102_444_800)
    val restored = TokenPayloadCodec.parse(TokenPayloadCodec.serialize(farFuture))
    assertEquals(4_102_444_800, restored?.expiresAtEpochSeconds)
  }
}
