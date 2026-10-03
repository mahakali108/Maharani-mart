package com.maharanitraders.app

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject
import okhttp3.OkHttpClient

/**
 * Application entry point.
 *
 * Deliberately thin: Hilt builds the graph (which wires the Keystore-backed
 * token store, the OkHttp/Retrofit stack and the single session controller) and
 * the session restore is kicked off through [SessionBootstrapper].
 *
 * The one extra responsibility is the process-wide image loader (Phase D added
 * server product imagery). It is configured here rather than per screen so every
 * image request in the app shares one HTTP client and one cache.
 */
@HiltAndroidApp
class MaharaniApplication : Application(), SingletonImageLoader.Factory {

  @Inject
  lateinit var sessionBootstrapper: SessionBootstrapper

  override fun onCreate() {
    super.onCreate()
    sessionBootstrapper.start()
  }

  /**
   * Coil 3 keeps network support in a separate artifact, so the OkHttp fetcher
   * is installed explicitly — without it every image request fails, which would
   * look like "the catalogue has no pictures" rather than a missing dependency.
   *
   * The fetcher uses a plain [OkHttpClient]: no custom trust manager, no relaxed
   * hostname verification and no cleartext, so the platform's TLS validation
   * stays fully in force for product imagery. Coil's own default disk and memory
   * caches are left in place — product artwork is public master data that
   * changes only when an admin replaces it.
   */
  override fun newImageLoader(context: PlatformContext): ImageLoader =
    ImageLoader.Builder(context)
      .components {
        add(OkHttpNetworkFetcherFactory(callFactory = { OkHttpClient() }))
      }
      .crossfade(true)
      .build()
}
