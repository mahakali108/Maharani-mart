package com.maharanitraders.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.auth.SignOutReason
import com.maharanitraders.core.designsystem.components.TertiaryAction

/** Test tags for the gate surfaces (drives the Phase C UI tests). */
object GateTags {
  const val GATE_TITLE = "gate_title"
  const val GATE_MESSAGE = "gate_message"
  const val GATE_RETRY = "gate_retry"
  const val GATE_SIGN_OUT = "gate_sign_out"
}

/**
 * What the user sees when there is no usable session.
 *
 * The copy mirrors the server's own gate codes one-for-one, and each gate says
 * which situation it is — a suspended account must never look like a network
 * problem, and a pending retailer must never be told to "try again" as if the
 * app were broken.
 *
 * Note for Phase B: this build restores and verifies an existing session but
 * does not yet sign in (Phase C adds the credential + refresh flow). The copy
 * says so plainly instead of showing a form that cannot work.
 */
@Composable
fun SessionGateScreen(
  reason: SignOutReason,
  onRetry: () -> Unit,
  onSignOut: () -> Unit,
) {
  val copy = gateCopy(reason)

  Column(
    modifier = Modifier
      .fillMaxSize()
      .padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = copy.title,
      style = MaterialTheme.typography.titleLarge,
      textAlign = TextAlign.Center,
      modifier = Modifier.testTag(GateTags.GATE_TITLE),
    )
    Text(
      text = copy.message,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier
        .padding(top = 8.dp)
        .testTag(GateTags.GATE_MESSAGE),
    )

    if (copy.retryLabel != null) {
      Button(
        onClick = onRetry,
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 24.dp)
          .testTag(GateTags.GATE_RETRY),
      ) {
        Text(copy.retryLabel)
      }
    }

    if (copy.showSignOut) {
      TertiaryAction(
        label = "Sign out",
        onClick = onSignOut,
        modifier = Modifier
          .padding(top = 8.dp)
          .testTag(GateTags.GATE_SIGN_OUT),
      )
    }
  }
}

/** The server told us the account cannot use the app right now. */
@Composable
fun UnsupportedAccountScreen(reason: String, onSignOut: () -> Unit) {
  Column(
    modifier = Modifier
      .fillMaxSize()
      .padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = "This build cannot open your account",
      style = MaterialTheme.typography.titleLarge,
      textAlign = TextAlign.Center,
    )
    Text(
      text = reason,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 8.dp),
    )
    Text(
      text = "Please update the app or contact Maharani Traders. Your web access is unaffected.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 12.dp),
    )
    TertiaryAction(
      label = "Sign out",
      onClick = onSignOut,
      modifier = Modifier.padding(top = 8.dp),
    )
  }
}

/** The session exists but could not be verified (offline, outage, timeout). */
@Composable
fun ConnectionProblemScreen(
  message: String,
  retryable: Boolean,
  onRetry: () -> Unit,
  onSignOut: () -> Unit,
) {
  Column(
    modifier = Modifier
      .fillMaxSize()
      .padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = "Can't reach Maharani Traders",
      style = MaterialTheme.typography.titleLarge,
      textAlign = TextAlign.Center,
      modifier = Modifier.testTag(GateTags.GATE_TITLE),
    )
    Text(
      text = message,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier
        .padding(top = 8.dp)
        .testTag(GateTags.GATE_MESSAGE),
    )
    Text(
      text = "Prices, stock and orders always need a live connection — the app will not guess them.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 12.dp),
    )
    if (retryable) {
      Button(
        onClick = onRetry,
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 24.dp)
          .testTag(GateTags.GATE_RETRY),
      ) {
        Text("Try again")
      }
    }
    TertiaryAction(
      label = "Sign out",
      onClick = onSignOut,
      modifier = Modifier
        .padding(top = 8.dp)
        .testTag(GateTags.GATE_SIGN_OUT),
    )
  }
}

private data class GateCopy(
  val title: String,
  val message: String,
  val retryLabel: String? = null,
  val showSignOut: Boolean = true,
)

private fun gateCopy(reason: SignOutReason): GateCopy = when (reason) {
  SignOutReason.PENDING_APPROVAL -> GateCopy(
    title = "Your shop is awaiting approval",
    message = "Maharani Traders reviews new retailer accounts before they can order. " +
      "You can check again once the shop has been approved.",
    retryLabel = "Check again",
  )

  SignOutReason.ACCESS_EXPIRED -> GateCopy(
    title = "Your access period has ended",
    message = "Your access has lapsed. Contact Maharani Traders to renew it, then check again — " +
      "your account and order history are unchanged.",
    retryLabel = "Check again",
  )

  SignOutReason.ACCOUNT_SUSPENDED -> GateCopy(
    title = "This account is suspended",
    message = "Ordering is paused for this account. Please contact Maharani Traders to resolve it.",
  )

  SignOutReason.ACCOUNT_INACTIVE -> GateCopy(
    title = "This account is not active",
    message = "The account is deactivated. Please contact Maharani Traders.",
  )

  SignOutReason.UNSUPPORTED_ACCOUNT -> GateCopy(
    title = "This build cannot open your account",
    message = "The account details sent by the server are not recognised by this app version. " +
      "Please update the app or contact Maharani Traders.",
  )

  SignOutReason.SESSION_EXPIRED -> GateCopy(
    title = "Your session has expired",
    message = "For security the app signs out when a session can no longer be verified. " +
      "This build is the native foundation (Phase B): sign-in is delivered with the " +
      "authentication phase, so nothing further happens here yet. Your web access is unchanged.",
    showSignOut = false,
  )

  SignOutReason.NEVER_SIGNED_IN, SignOutReason.SIGNED_OUT -> GateCopy(
    title = "Sign in to Maharani Traders",
    message = "This build is the native foundation (Phase B) of the Maharani Traders app. " +
      "It restores and verifies an existing session, but signing in is delivered with the " +
      "authentication phase. Your web access is unchanged in the meantime.",
    showSignOut = false,
  )
}
