package com.maharanitraders.core.auth

import com.maharanitraders.core.model.SessionTokens

/**
 * The plaintext payload format inside the encrypted session file.
 *
 * Kept separate from [KeystoreTokenStore] so the format — which is what decides
 * whether a stored session can be trusted after an app update — is verified by
 * ordinary JVM unit tests instead of only on a device.
 *
 * Format: `v1|accessToken|refreshToken|expiresAtEpochSeconds`
 *
 * The separator is safe because tokens are base64url (unpadded) and never
 * contain `|`. Parsing is strict: an unknown version, a missing field, an empty
 * token or a non-numeric expiry are all rejected (`null`), and the caller treats
 * that as "no session" instead of using a partially-restored one.
 */
internal object TokenPayloadCodec {

  const val FORMAT_VERSION = "v1"
  const val SEPARATOR = "|"

  fun serialize(tokens: SessionTokens): String = buildString {
    append(FORMAT_VERSION)
    append(SEPARATOR)
    append(tokens.accessToken)
    append(SEPARATOR)
    append(tokens.refreshToken)
    append(SEPARATOR)
    append(tokens.expiresAtEpochSeconds)
  }

  fun parse(plain: String): SessionTokens? {
    val parts = plain.split(SEPARATOR)
    if (parts.size != 4 || parts[0] != FORMAT_VERSION) return null

    val accessToken = parts[1]
    val refreshToken = parts[2]
    if (accessToken.isEmpty() || refreshToken.isEmpty()) return null

    val expiresAt = parts[3].toLongOrNull() ?: return null
    return SessionTokens(
      accessToken = accessToken,
      refreshToken = refreshToken,
      expiresAtEpochSeconds = expiresAt,
    )
  }
}
