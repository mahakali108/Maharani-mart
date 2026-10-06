package com.maharanitraders.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.TertiaryAction

object PasswordResetTags {
  const val EMAIL = "password_reset_email"
  const val SUBMIT = "password_reset_submit"
  const val MESSAGE = "password_reset_message"
}

@Composable
fun PasswordResetScreen(
  state: PasswordResetUiState,
  onEmailChange: (String) -> Unit,
  onSubmit: () -> Unit,
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text("Reset your password", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
    Text(
      "Enter the email address on your retailer account. The reset link opens in your browser, where you can finish securely.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 8.dp, bottom = 20.dp),
    )
    OutlinedTextField(
      value = state.email,
      onValueChange = onEmailChange,
      label = { Text("Account email") },
      singleLine = true,
      isError = state.fieldError != null,
      supportingText = state.fieldError?.let { error -> { Text(error) } },
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
      modifier = Modifier.fillMaxWidth().testTag(PasswordResetTags.EMAIL),
    )
    state.message?.let { message ->
      Text(
        message,
        color = if (state.submitted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp).testTag(PasswordResetTags.MESSAGE),
      )
    }
    Button(
      onClick = onSubmit,
      enabled = state.canSubmit,
      modifier = Modifier.fillMaxWidth().padding(top = 20.dp).testTag(PasswordResetTags.SUBMIT),
    ) {
      if (state.submitting) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.padding(end = 8.dp))
      Text(if (state.submitting) "Sending…" else "Send reset instructions")
    }
    TertiaryAction(label = "Back to sign in", onClick = onBack, modifier = Modifier.padding(top = 8.dp))
  }
}
