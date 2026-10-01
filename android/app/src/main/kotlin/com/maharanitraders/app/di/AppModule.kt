package com.maharanitraders.app.di

import com.maharanitraders.app.ApiBaseUrlContract
import com.maharanitraders.app.BuildConfig
import com.maharanitraders.core.network.di.ApiBaseUrl
import com.maharanitraders.core.network.di.HttpLoggingEnabled
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Binds the only two values the application module contributes to the object
 * graph: where the API lives, and whether HTTP logging is on.
 *
 * Both come from `BuildConfig`, which contains no credentials — the Android
 * client holds no database key, service-role key or provider secret (all
 * authentication is proxied through `/api/mobile/v1`; see
 * docs/NATIVE_ANDROID_API_CONTRACT.md §1).
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

  @Provides
  @Singleton
  @ApiBaseUrl
  fun provideApiBaseUrl(): String = ApiBaseUrlContract.requireValid(BuildConfig.API_BASE_URL)

  /**
   * HTTP logging is enabled in debug builds ONLY, and the interceptor is
   * configured with `Level.BASIC` + a redacted `Authorization` header, so a
   * token can never reach logcat or a crash report even on a developer device.
   */
  @Provides
  @Singleton
  @HttpLoggingEnabled
  fun provideHttpLoggingEnabled(): Boolean = BuildConfig.DEBUG
}
