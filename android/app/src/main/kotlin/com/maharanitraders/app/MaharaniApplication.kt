package com.maharanitraders.app

import android.app.Application
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * Application entry point.
 *
 * Deliberately thin: Hilt builds the graph (which wires the Keystore-backed
 * token store, the OkHttp/Retrofit stack and the single session controller) and
 * the session restore is kicked off through [SessionBootstrapper].
 */
@HiltAndroidApp
class MaharaniApplication : Application() {

  @Inject
  lateinit var sessionBootstrapper: SessionBootstrapper

  override fun onCreate() {
    super.onCreate()
    sessionBootstrapper.start()
  }
}
