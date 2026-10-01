package com.maharanitraders.app.di

import com.maharanitraders.app.ApiBaseUrlContract
import com.maharanitraders.app.BuildConfig
import com.maharanitraders.core.network.di.ApiBaseUrl
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Binds the API base URL from `BuildConfig`, which contains no credentials —
 * the Android client holds no database key, service-role key or provider secret
 * (all authentication is proxied through `/api/mobile/v1`; see
 * docs/NATIVE_ANDROID_API_CONTRACT.md §1).
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

  @Provides
  @Singleton
  @ApiBaseUrl
  fun provideApiBaseUrl(): String = ApiBaseUrlContract.requireValid(
    BuildConfig.API_BASE_URL,
    allowLocalHttp = BuildConfig.DEBUG,
  )
}
