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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.maharanitraders.core.designsystem.components.TertiaryAction

object SecurityTags {
  const val SCREEN = "security_screen"
  const val TITLE = "security_title"
  const val SIGNED_IN_AS = "security_signed_in_as"
  const val PASSWORD = "security_password"
  const val CONFIRM_PASSWORD = "security_confirm_password"
  const val SUBMIT = "security_submit"
  const val ERROR = "security_error"
  const val SUCCESS = "security_success"
  const val BACK = "security_back"
}

/**
 * The in-account security screen: change the signed-in account's password.
 *
 * The change runs through `POST /api/mobile/v1/auth/password-update`, which
 * performs the update with the caller's OWN bearer token against GoTrue — so
 * only the signed-in account can change its password, and a suspended,
 * pending or expired account is rejected by the same gate as every other
 * protected endpoint. This screen therefore sends nothing but the two fields,
 * shows the server's own verdict, and never claims a change it did not get a
 * `200` for.
 *
 * The web security page additionally offers "log out of all sessions" and
 * account deletion / data-export requests; those ride on web server actions
 * with no mobile endpoint, so they are deliberately absent here rather than
 * faked.
 */
@Composable
fun SecurityScreen(
  state: ChangePasswordUiState,
  signedInAs: String?,
  onPasswordChange: (String) -> Unit,
  onConfirmPasswordChange: (String) -> Unit,
  onSubmit: () -> Unit,
  onDone: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(24.dp)
      .testTag(SecurityTags.SCREEN),
    verticalArrangement = Arrangement.spacedBy(12.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Column(
      modifier = Modifier.fillMaxWidth(),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Text(
        text = "Password & security",
        style = MaterialTheme.typography.headlineSmall,
        modifier = Modifier
          .padding(top = 8.dp)
          .testTag(SecurityTags.TITLE),
      )
      Text(
        text = signedInAs?.let { "Signed in as $it" }
          ?: "Change the password of the signed-in account.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
          .padding(top = 4.dp)
          .testTag(SecurityTags.SIGNED_IN_AS),
      )
    }

    if (state.updated) {
      Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier
          .fillMaxWidth()
          .testTag(SecurityTags.SUCCESS),
      ) {
        Column(modifier = Modifier.padding(16.dp)) {
          Text(
            text = "Password updated",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
          )
          Text(
            text = "Your password was changed on Maharani Traders' servers. Use the new " +
              "password the next time you sign in; this device stays signed in.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(top = 4.dp),
          )
        }
      }
      Button(
        onClick = onDone,
        modifier = Modifier
          .fillMaxWidth()
          .testTag(SecurityTags.BACK),
      ) {
        Text("Back to account")
      }
      return
    }

    OutlinedTextField(
      value = state.password,
      onValueChange = onPasswordChange,
      label = { Text("New password") },
      supportingText = {
        Text(state.fieldErrors[ChangePasswordViewModel.FIELD_PASSWORD] ?: "At least 8 characters.")
      },
      singleLine = true,
      isError = state.fieldErrors.containsKey(ChangePasswordViewModel.FIELD_PASSWORD),
      visualTransformation = PasswordVisualTransformation(),
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
      modifier = Modifier
        .fillMaxWidth()
        .testTag(SecurityTags.PASSWORD),
    )

    OutlinedTextField(
      value = state.confirmPassword,
      onValueChange = onConfirmPasswordChange,
      label = { Text("Confirm new password") },
      supportingText = state.fieldErrors[ChangePasswordViewModel.FIELD_CONFIRM]?.let { message ->
        { Text(message) }
      },
      singleLine = true,
      isError = state.fieldErrors.containsKey(ChangePasswordViewModel.FIELD_CONFIRM),
      visualTransformation = PasswordVisualTransformation(),
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
      modifier = Modifier
        .fillMaxWidth()
        .testTag(SecurityTags.CONFIRM_PASSWORD),
    )

    state.formError?.let { message ->
      Text(
        text = message,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier
          .fillMaxWidth()
          .testTag(SecurityTags.ERROR),
      )
    }

    Button(
      onClick = onSubmit,
      enabled = state.canSubmit,
      modifier = Modifier
        .fillMaxWidth()
        .padding(top = 8.dp)
        .testTag(SecurityTags.SUBMIT),
    ) {
      if (state.submitting) {
        CircularProgressIndicator(
          modifier = Modifier.padding(end = 8.dp),
          strokeWidth = 2.dp,
          color = MaterialTheme.colorScheme.onPrimary,
        )
      }
      Text(if (state.submitting) "Updating…" else "Update password")
    }

    Text(
      text = "The change is made on the server with this device's own session. Prices, " +
        "stock and orders are unaffected.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.padding(top = 4.dp),
    )

    TertiaryAction(
      label = "Cancel",
      onClick = onDone,
      enabled = !state.submitting,
      modifier = Modifier.testTag(SecurityTags.BACK),
    )
  }
}
