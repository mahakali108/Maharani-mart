package com.maharanitraders.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.maharanitraders.app.ui.MaharaniApp
import com.maharanitraders.core.auth.SessionController
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.launch

/**
 * The app's only Activity.
 *
 * Responsibilities are deliberately small: install the native splash, go
 * edge-to-edge, observe the session state lifecycle-aware, and forward user
 * intents. Navigation and content live in Compose; all state lives in injected
 * components.
 *
 * `configChanges` in the manifest covers rotation, uiMode and font scale, so
 * the Compose tree keeps its state and an in-flight request is not cancelled
 * when the user rotates the device or changes text size.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

  @Inject
  lateinit var session: SessionController

  override fun onCreate(savedInstanceState: Bundle?) {
    // Native splash: violet identity + the existing launcher foreground, then the
    // Compose surface takes over (identical colours, so there is no flash).
    installSplashScreen()
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    setContent {
      val state by session.state.collectAsStateWithLifecycle()

      MaharaniApp(
        sessionState = state,
        onRetrySession = { lifecycleScope.launch { session.restore() } },
        onSignOut = { lifecycleScope.launch { session.signOut() } },
      )
    }
  }
}
