package com.maharanitraders.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.TertiaryAction

object ForgotPasswordTags {
  const val TITLE = "forgot_password_title"
  const val EMAIL = "forgot_password_email"
  const val SUBMIT = "forgot_password_submit"
  const val ERROR = "forgot_password_error"
  const val SENT_TITLE = "forgot_password_sent_title"
  const val SENT_DETAIL = "forgot_password_sent_detail"
  const val BACK_TO_LOGIN = "forgot_password_back"
}

/**
 * Forgot password: request the reset email.
 *
 * Honest about where the reset completes: Supabase delivers the recovery link
 * to the Maharani Traders WEBSITE (the app registers no deep link yet — see
 * the endpoint's own limitation note in
 * `app/api/mobile/v1/auth/password-reset/route.ts`), so the confirmation says
 * exactly that instead of pretending the app resets the password itself.
 */
@Composable
fun ForgotPasswordScreen(
  state: ForgotPasswordUiState,
  onEmailChange: (String) -> Unit,
  onSubmit: () -> Unit,
  onBackToLogin: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (state.sent) {
    ResetSentContent(email = state.email, onBackToLogin = onBackToLogin, modifier = modifier)
    return
  }

  Column(
    modifier = modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = "Forgot password?",
      style = MaterialTheme.typography.headlineSmall,
      textAlign = TextAlign.Center,
      modifier = Modifier.testTag(ForgotPasswordTags.TITLE),
    )
    Text(
      text = "Enter the email your shop account uses and we'll send you a secure link to set a new password.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 4.dp, bottom = 24.dp),
    )

    OutlinedTextField(
      value = state.email,
      onValueChange = onEmailChange,
      label = { Text("Registered email") },
      singleLine = true,
      isError = state.fieldError != null,
      supportingText = state.fieldError?.let { message -> { Text(message) } },
      keyboardOptions = KeyboardOptions(
        keyboardType = KeyboardType.Email,
        imeAction = ImeAction.Done,
      ),
      keyboardActions = KeyboardActions(onDone = { if (state.canSubmit) onSubmit() }),
      modifier = Modifier
        .fillMaxWidth()
        .testTag(ForgotPasswordTags.EMAIL),
    )

    state.formError?.let { message ->
      Text(
        text = message,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.error,
        textAlign = TextAlign.Center,
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 12.dp)
          .testTag(ForgotPasswordTags.ERROR),
      )
    }

    Button(
      onClick = onSubmit,
      enabled = state.canSubmit,
      modifier = Modifier
        .fillMaxWidth()
        .padding(top = 20.dp)
        .testTag(ForgotPasswordTags.SUBMIT),
    ) {
      if (state.submitting) {
        CircularProgressIndicator(
          modifier = Modifier.padding(end = 8.dp),
          strokeWidth = 2.dp,
          color = MaterialTheme.colorScheme.onPrimary,
        )
      }
      Text(if (state.submitting) "Sending…" else "Email me the reset link")
    }

    TertiaryAction(
      label = "Back to sign in",
      onClick = onBackToLogin,
      enabled = !state.submitting,
      modifier = Modifier
        .padding(top = 8.dp)
        .testTag(ForgotPasswordTags.BACK_TO_LOGIN),
    )
  }
}

/**
 * Confirmation after the server accepted the request.
 *
 * The copy is deliberately generic: the endpoint answers the same whether or
 * not the address has an account, so the screen must not claim an email went
 * to a specific shop. It also states where the reset completes, because that
 * is where the shopper will actually continue.
 */
@Composable
private fun ResetSentContent(
  email: String,
  onBackToLogin: () -> Unit,
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
      text = "Check your email",
      style = MaterialTheme.typography.headlineSmall,
      textAlign = TextAlign.Center,
      modifier = Modifier.testTag(ForgotPasswordTags.SENT_TITLE),
    )
    Text(
      text = "If an account exists for ${email.trim()}, you will receive a password reset " +
        "link shortly.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 8.dp),
    )
    Text(
      text = "The link opens the Maharani Traders website, where you can choose a new " +
        "password. Reset links currently complete on the website — this app does not " +
        "register the deep link yet, so sign in here again once you have set the new password.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier
        .padding(top = 12.dp)
        .testTag(ForgotPasswordTags.SENT_DETAIL),
    )
    Button(
      onClick = onBackToLogin,
      modifier = Modifier
        .fillMaxWidth()
        .padding(top = 24.dp)
        .testTag(ForgotPasswordTags.BACK_TO_LOGIN),
    ) {
      Text("Back to sign in")
    }
  }
}
