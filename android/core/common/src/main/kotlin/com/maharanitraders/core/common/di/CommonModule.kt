package com.maharanitraders.core.common.di

import com.maharanitraders.core.common.AndroidNetworkMonitor
import com.maharanitraders.core.common.NetworkMonitor
import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.core.common.SystemTimeSource
import com.maharanitraders.core.common.TimeSource
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.multibindings.Multibinds
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Qualifier
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Coroutine dispatcher qualifiers — injected instead of referencing
 * `Dispatchers.*` directly, so view models and repositories remain testable
 * with `StandardTestDispatcher`.
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class IoDispatcher

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class DefaultDispatcher

/**
 * Scope that lives exactly as long as the process — for work that must survive
 * an Activity recreation (session bootstrap, later: token refresh and
 * notification registration). Never used for UI work.
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ApplicationScope

@Module
@InstallIn(SingletonComponent::class)
object DispatchersModule {

  @Provides
  @IoDispatcher
  fun provideIoDispatcher(): CoroutineDispatcher = Dispatchers.IO

  @Provides
  @DefaultDispatcher
  fun provideDefaultDispatcher(): CoroutineDispatcher = Dispatchers.Default

  @Provides
  @Singleton
  @ApplicationScope
  fun provideApplicationScope(@DefaultDispatcher dispatcher: CoroutineDispatcher): CoroutineScope =
    CoroutineScope(SupervisorJob() + dispatcher)
}

@Module
@InstallIn(SingletonComponent::class)
abstract class CommonBindingsModule {

  @Binds
  @Singleton
  abstract fun bindTimeSource(impl: SystemTimeSource): TimeSource

  @Binds
  @Singleton
  abstract fun bindNetworkMonitor(impl: AndroidNetworkMonitor): NetworkMonitor

  /**
   * Declares the (possibly empty) set of session-scoped caches the session layer
   * clears when a session ends.
   *
   * Hilt cannot inject a `Set<T>` that no module contributes to unless the
   * multibinding is declared, and an empty set is a completely normal state:
   * it is what a build with no session-scoped caches looks like. Feature
   * modules add their own stores with `@Provides @IntoSet`, and `core:auth` —
   * which is the only consumer — stays free of feature dependencies.
   */
  @Multibinds
  abstract fun sessionScopedStores(): Set<SessionScopedStore>
}
