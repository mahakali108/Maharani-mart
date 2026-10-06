package com.maharanitraders.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.TertiaryAction

object LoginTags {
  const val IDENTIFIER = "login_identifier"
  const val PASSWORD = "login_password"
  const val SUBMIT = "login_submit"
  const val ERROR = "login_error"
  const val OPEN_REGISTER = "login_open_register"
  const val OPEN_FORGOT_PASSWORD = "login_open_forgot_password"
}

/**
 * Sign-in.
 *
 * Deliberately plain about what it does: the app is online-first, so the button
 * says "Sign in" and reports exactly what the server said. There is no
 * "continue offline" path and no optimistic success.
 */
@Composable
fun LoginScreen(
  state: LoginUiState,
  onIdentifierChange: (String) -> Unit,
  onPasswordChange: (String) -> Unit,
  onSubmit: () -> Unit,
  onOpenRegister: () -> Unit,
  onOpenForgotPassword: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = "Maharani Traders",
      style = MaterialTheme.typography.headlineSmall,
      textAlign = TextAlign.Center,
    )
    Text(
      text = "Wholesale ordering for your shop",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 4.dp, bottom = 24.dp),
    )

    OutlinedTextField(
      value = state.identifier,
      onValueChange = onIdentifierChange,
      label = { Text("Mobile number or email") },
      singleLine = true,
      isError = state.fieldErrors.containsKey(LoginViewModel.FIELD_IDENTIFIER),
      supportingText = state.fieldErrors[LoginViewModel.FIELD_IDENTIFIER]?.let { message ->
        { Text(message) }
      },
      keyboardOptions = KeyboardOptions(
        keyboardType = KeyboardType.Email,
        imeAction = ImeAction.Next,
      ),
      modifier = Modifier
        .fillMaxWidth()
        .testTag(LoginTags.IDENTIFIER),
    )

    OutlinedTextField(
      value = state.password,
      onValueChange = onPasswordChange,
      label = { Text("Password") },
      singleLine = true,
      visualTransformation = PasswordVisualTransformation(),
      isError = state.fieldErrors.containsKey(LoginViewModel.FIELD_PASSWORD),
      supportingText = state.fieldErrors[LoginViewModel.FIELD_PASSWORD]?.let { message ->
        { Text(message) }
      },
      keyboardOptions = KeyboardOptions(
        keyboardType = KeyboardType.Password,
        imeAction = ImeAction.Done,
      ),
      keyboardActions = KeyboardActions(onDone = { if (state.canSubmit) onSubmit() }),
      modifier = Modifier
        .fillMaxWidth()
        .padding(top = 8.dp)
        .testTag(LoginTags.PASSWORD),
    )

    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.End,
    ) {
      TertiaryAction(
        label = "Forgot password?",
        onClick = onOpenForgotPassword,
        enabled = !state.submitting,
        modifier = Modifier.testTag(LoginTags.OPEN_FORGOT_PASSWORD),
      )
    }

    state.formError?.let { message ->
      Text(
        text = message,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.error,
        textAlign = TextAlign.Center,
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 12.dp)
          .testTag(LoginTags.ERROR),
      )
    }

    Button(
      onClick = onSubmit,
      enabled = state.canSubmit,
      modifier = Modifier
        .fillMaxWidth()
        .padding(top = 20.dp)
        .testTag(LoginTags.SUBMIT),
    ) {
      if (state.submitting) {
        CircularProgressIndicator(
          modifier = Modifier.padding(end = 8.dp),
          strokeWidth = 2.dp,
          color = MaterialTheme.colorScheme.onPrimary,
        )
      }
      Text(if (state.submitting) "Signing in…" else "Sign in")
    }

    TertiaryAction(
      label = "New retailer? Register your shop",
      onClick = onOpenRegister,
      enabled = !state.submitting,
      modifier = Modifier
        .padding(top = 8.dp)
        .testTag(LoginTags.OPEN_REGISTER),
    )

    Text(
      text = "Prices, stock and orders always come from Maharani Traders' servers — " +
        "the app never calculates or caches them on its own.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 24.dp),
    )
  }
}
