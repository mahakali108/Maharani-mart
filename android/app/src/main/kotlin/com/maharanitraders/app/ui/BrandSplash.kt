package com.maharanitraders.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Test tag for the restore-in-progress surface. */
const val BRAND_SPLASH_TAG = "brand_splash"

/**
 * In-app continuation of the system splash: the same brand red, the same
 * wordmark, while stored credentials are verified with the server.
 *
 * It shows no account data — nothing about the user is displayed until the
 * server has confirmed the session.
 */
@Composable
fun BrandSplash() {
  Surface(
    modifier = Modifier
      .fillMaxSize()
      .testTag(BRAND_SPLASH_TAG),
    color = MaterialTheme.colorScheme.primary,
    contentColor = MaterialTheme.colorScheme.onPrimary,
  ) {
    Column(
      modifier = Modifier
        .fillMaxSize()
        .padding(32.dp),
      verticalArrangement = Arrangement.Center,
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Text(
        text = "Maharani Traders",
        style = MaterialTheme.typography.headlineMedium,
        textAlign = TextAlign.Center,
      )
      Text(
        text = "Wholesale & distribution",
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 4.dp),
      )
      CircularProgressIndicator(
        modifier = Modifier
          .padding(top = 32.dp)
          .size(28.dp),
        color = MaterialTheme.colorScheme.onPrimary,
      )
      Text(
        text = "Checking your session…",
        style = MaterialTheme.typography.bodySmall,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 12.dp),
      )
    }
  }
}
