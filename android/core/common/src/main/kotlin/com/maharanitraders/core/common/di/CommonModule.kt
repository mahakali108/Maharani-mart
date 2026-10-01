package com.maharanitraders.core.common.di

import com.maharanitraders.core.common.AndroidNetworkMonitor
import com.maharanitraders.core.common.NetworkMonitor
import com.maharanitraders.core.common.SystemTimeSource
import com.maharanitraders.core.common.TimeSource
import dagger.Binds
import dagger.Module
import dagger.Provides
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
}
