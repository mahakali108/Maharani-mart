package com.maharanitraders.core.auth

import com.maharanitraders.core.model.SessionTokens

/**
 * Persistent storage for session tokens.
 *
 * The ONLY production implementation is Keystore-backed and encrypted
 * ([KeystoreTokenStore]). Tokens must never be written to plaintext
 * preferences, logs, analytics or crash reports — the interface exists so that
 * tests (and only tests) can substitute an in-memory implementation.
 */
interface TokenStore {
  suspend fun read(): SessionTokens?

  suspend fun write(tokens: SessionTokens)

  suspend fun clear()
}
