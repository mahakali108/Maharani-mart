package com.maharanitraders.core.network.di

import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.ApiErrorMapper
import com.maharanitraders.core.network.AuthInterceptor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.TokenProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * API base URL. Supplied by the application module from `BuildConfig` — it is
 * the ONLY configuration value compiled into the app, and it is not a secret.
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ApiBaseUrl

/** True in debug builds; enables BASIC HTTP logging (never headers or bodies). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class HttpLoggingEnabled

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

  private const val CONNECT_TIMEOUT_SECONDS = 15L
  private const val READ_TIMEOUT_SECONDS = 30L
  private const val CALL_TIMEOUT_SECONDS = 45L

  @Provides
  @Singleton
  fun provideJson(): Json = Json {
    // Additive server changes must not crash an installed app.
    ignoreUnknownKeys = true
    // Absent optional fields keep their defaults instead of failing.
    explicitNulls = false
    coerceInputValues = true
  }

  @Provides
  @Singleton
  fun provideOkHttpClient(
    tokenProvider: TokenProvider,
    @HttpLoggingEnabled httpLoggingEnabled: Boolean,
  ): OkHttpClient {
    val builder = OkHttpClient.Builder()
      .addInterceptor(AuthInterceptor(tokenProvider))
      .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .retryOnConnectionFailure(true)

    if (httpLoggingEnabled) {
      // BASIC = method, URL and status only. Headers and bodies are never
      // logged, so an access token cannot leak into logcat or a crash report.
      builder.addInterceptor(
        HttpLoggingInterceptor().apply {
          level = HttpLoggingInterceptor.Level.BASIC
          redactHeader("Authorization")
        }
      )
    }

    return builder.build()
  }

  @Provides
  @Singleton
  fun provideRetrofit(
    @ApiBaseUrl baseUrl: String,
    client: OkHttpClient,
    json: Json,
  ): Retrofit = Retrofit.Builder()
    .baseUrl(baseUrl)
    .client(client)
    .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
    .build()

  @Provides
  @Singleton
  fun provideMaharaniApi(retrofit: Retrofit): MaharaniApi = retrofit.create(MaharaniApi::class.java)

  @Provides
  @Singleton
  fun provideApiErrorMapper(json: Json): ApiErrorMapper = ApiErrorMapper(json)

  @Provides
  @Singleton
  fun provideApiCallExecutor(
    errorMapper: ApiErrorMapper,
    @com.maharanitraders.core.common.di.IoDispatcher ioDispatcher: kotlinx.coroutines.CoroutineDispatcher,
  ): ApiCallExecutor = ApiCallExecutor(errorMapper, ioDispatcher)
}
