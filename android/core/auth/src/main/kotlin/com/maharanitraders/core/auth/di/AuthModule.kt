package com.maharanitraders.core.auth.di

import com.maharanitraders.core.auth.KeystoreTokenStore
import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.auth.SessionManager
import com.maharanitraders.core.auth.TokenStore
import com.maharanitraders.core.network.TokenProvider
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Wiring for the authentication slice.
 *
 * The important property: [SessionManager] is bound exactly once (as
 * [SessionController]) and the network layer's [TokenProvider] is a thin
 * adapter over it. There is therefore a single in-memory token holder, so
 * sign-out can never leave a second copy of a token behind.
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

  companion object {

    /**
     * Read-only view of the current token for OkHttp. It cannot read the token
     * store, cannot refresh, and cannot write — the interceptor's only power is
     * to attach (or omit) an Authorization header.
     */
    @Provides
    @Singleton
    fun provideTokenProvider(session: SessionController): TokenProvider =
      TokenProvider { session.accessToken() }
  }
}
