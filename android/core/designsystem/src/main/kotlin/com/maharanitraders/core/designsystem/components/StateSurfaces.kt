package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens

/**
 * Shared state surfaces. Every list, detail and form screen renders one of
 * these instead of an ad-hoc spinner or an empty white page, so the four states
 * required by the migration (loading / empty / offline / error+retry) look and
 * behave the same everywhere and are addressable from UI tests via test tags.
 */
object StateTags {
  const val LOADING = "state_loading"
  const val EMPTY = "state_empty"
  const val ERROR = "state_error"
  const val OFFLINE = "state_offline"
  const val UNAVAILABLE = "state_unavailable"
}

@Composable
fun LoadingState(
  message: String = "Loading…",
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .padding(24.dp)
      .testTag(StateTags.LOADING),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    CircularProgressIndicator()
    Text(
      text = message,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.padding(top = 16.dp),
    )
  }
}

@Composable
fun EmptyState(
  title: String,
  message: String,
  modifier: Modifier = Modifier,
  actionLabel: String? = null,
  onAction: (() -> Unit)? = null,
) {
  StateMessage(
    title = title,
    message = message,
    modifier = modifier.testTag(StateTags.EMPTY),
    actionLabel = actionLabel,
    onAction = onAction,
  )
}

@Composable
fun ErrorState(
  message: String,
  modifier: Modifier = Modifier,
  retryable: Boolean = true,
  onRetry: (() -> Unit)? = null,
) {
  StateMessage(
    title = "Something went wrong",
    message = message,
    modifier = modifier.testTag(StateTags.ERROR),
    actionLabel = if (retryable && onRetry != null) "Try again" else null,
    onAction = onRetry,
  )
}

@Composable
fun OfflineState(
  modifier: Modifier = Modifier,
  onRetry: (() -> Unit)? = null,
) {
  StateMessage(
    title = "You are offline",
    message = "Check your internet connection. Orders and stock always need the server to confirm them.",
    modifier = modifier.testTag(StateTags.OFFLINE),
    actionLabel = if (onRetry != null) "Try again" else null,
    onAction = onRetry,
  )
}

/**
 * Honest placeholder for a capability that is NOT built yet.
 *
 * The migration plan forbids showing fabricated data or a fake success, so
 * screens that belong to a later phase say so plainly, name the phase, and
 * offer no action that would pretend to work.
 */
@Composable
fun UnavailableFeatureState(
  title: String,
  message: String,
  phaseLabel: String,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .padding(24.dp)
      .testTag(StateTags.UNAVAILABLE),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Surface(
      color = MaharaniThemeTokens.colors.warningSurface,
      contentColor = MaharaniThemeTokens.colors.warning,
      shape = MaterialTheme.shapes.small,
    ) {
      Text(
        text = phaseLabel,
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
      )
    }
    Text(
      text = title,
      style = MaterialTheme.typography.titleLarge,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 16.dp),
    )
    Text(
      text = message,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 8.dp),
    )
  }
}

@Composable
private fun StateMessage(
  title: String,
  message: String,
  modifier: Modifier = Modifier,
  actionLabel: String? = null,
  onAction: (() -> Unit)? = null,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = title,
      style = MaterialTheme.typography.titleLarge,
      textAlign = TextAlign.Center,
    )
    Text(
      text = message,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 8.dp),
    )
    if (actionLabel != null && onAction != null) {
      Button(
        onClick = onAction,
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 20.dp),
      ) {
        Text(actionLabel)
      }
    }
  }
}

/** Secondary action row used by gate screens (retry / sign out). */
@Composable
fun SecondaryAction(
  label: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  OutlinedButton(onClick = onClick, modifier = modifier) { Text(label) }
}

/** Tertiary link-style action (e.g. "Sign out" under a gate message). */
@Composable
fun TertiaryAction(
  label: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  TextButton(onClick = onClick, modifier = modifier) { Text(label) }
}
