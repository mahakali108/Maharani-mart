package com.maharanitraders.core.auth.di

import com.maharanitraders.core.auth.KeystoreTokenStore
import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.auth.SessionManager
import com.maharanitraders.core.auth.TokenStore
import com.maharanitraders.core.network.ActiveTokenHolder
import com.maharanitraders.core.network.TokenProvider
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Wiring for the authentication slice.
 *
 * The important property: [SessionManager] is bound exactly once (as
 * [SessionController]), and the network layer's [TokenProvider] is
 * [ActiveTokenHolder] — the SINGLE in-memory token, which the session layer
 * writes and the interceptor reads. There is therefore one copy of a token in
 * memory, so sign-out can never leave a second one behind.
 *
 * The holder is deliberately not derived from [SessionController]: the session
 * manager needs the API client, and the client needs the token, so a provider
 * that called back into the session layer would be a dependency cycle.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class AuthModule {

  /**
   * The only [TokenStore] binding in the app is the Keystore-backed one.
   * Tokens are never written to preferences, files in cleartext, logs or
   * analytics.
   */
  @Binds
  @Singleton
  abstract fun bindTokenStore(impl: KeystoreTokenStore): TokenStore

  @Binds
  @Singleton
  abstract fun bindSessionController(impl: SessionManager): SessionController

  /**
   * The interceptor's read-only view: a holder that cannot read the token store,
   * cannot refresh, and cannot reach the network. Its only power is to attach
   * (or omit) an Authorization header; only [SessionManager] ever writes it.
   */
  @Binds
  @Singleton
  abstract fun bindTokenProvider(impl: ActiveTokenHolder): TokenProvider
}
