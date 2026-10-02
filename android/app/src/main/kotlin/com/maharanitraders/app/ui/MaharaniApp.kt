package com.maharanitraders.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.maharanitraders.app.navigation.AuthenticatedShell
import com.maharanitraders.core.auth.SessionState
import com.maharanitraders.core.auth.SignOutReason
import com.maharanitraders.core.designsystem.theme.MaharaniTheme
import com.maharanitraders.feature.auth.AuthFlowScreen

/**
 * Root of the native UI: exactly one place decides what the app shows for the
 * current session state.
 *
 * This is deliberately a `when` over a sealed type, with no cached-identity
 * branch: an unverified session can never reach the signed-in shell.
 */
@Composable
fun MaharaniApp(
  sessionState: SessionState,
  onRetrySession: () -> Unit,
  onSignOut: () -> Unit,
  onSignedIn: () -> Unit = {},
) {
  MaharaniTheme {
    Surface(
      modifier = Modifier.fillMaxSize(),
      color = MaterialTheme.colorScheme.background,
    ) {
      when (sessionState) {
        SessionState.Restoring -> BrandSplash()

        is SessionState.Authenticated -> AuthenticatedShell(
          snapshot = sessionState.snapshot,
          onSignOut = onSignOut,
        )

        is SessionState.Unavailable -> ConnectionProblemScreen(
          message = sessionState.message,
          retryable = sessionState.retryable,
          onRetry = onRetrySession,
          onSignOut = onSignOut,
        )

        is SessionState.SignedOut -> when (sessionState.reason) {
          // These three mean "there is no session, and you can create one" —
          // so the user gets the real sign-in / registration flow.
          SignOutReason.NEVER_SIGNED_IN,
          SignOutReason.SIGNED_OUT,
          SignOutReason.SESSION_EXPIRED,
          -> AuthFlowScreen(
            onSignedIn = onSignedIn,
            onSignOut = onSignOut,
          )

          // Every other reason is an account-state decision made by the server.
          // Showing a sign-in form would be wrong: the credentials are fine, the
          // account is not.
          else -> SessionGateScreen(
            reason = sessionState.reason,
            onRetry = onRetrySession,
            onSignOut = onSignOut,
          )
        }
      }
    }
  }
}
