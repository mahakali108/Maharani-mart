package com.maharanitraders.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.maharanitraders.core.designsystem.components.TertiaryAction

object RegisterTags {
  const val FULL_NAME = "register_full_name"
  const val SHOP_NAME = "register_shop_name"
  const val PHONE = "register_phone"
  const val EMAIL = "register_email"
  const val ADDRESS = "register_address"
  const val PASSWORD = "register_password"
  const val CONFIRM_PASSWORD = "register_confirm_password"
  const val AREA_LIST = "register_area_list"
  const val AREA_ERROR = "register_area_error"
  const val AREA_RETRY = "register_area_retry"
  const val SUBMIT = "register_submit"
  const val ERROR = "register_error"
  const val BACK = "register_back"
}

/**
 * Retailer registration.
 *
 * The area picker is populated from the server, and when that list cannot be
 * loaded the form says so and offers a retry instead of letting the user submit
 * an area the database will reject. The success screen is owned by
 * `AuthFlowScreen` (pending approval) — this screen never claims the shop can
 * order.
 */
@Composable
fun RegisterScreen(
  state: RegisterUiState,
  onFullNameChange: (String) -> Unit,
  onShopNameChange: (String) -> Unit,
  onPhoneChange: (String) -> Unit,
  onEmailChange: (String) -> Unit,
  onAddressChange: (String) -> Unit,
  onPasswordChange: (String) -> Unit,
  onConfirmPasswordChange: (String) -> Unit,
  onAreaChange: (String) -> Unit,
  onRetryAreas: () -> Unit,
  onSubmit: () -> Unit,
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(24.dp),
    verticalArrangement = Arrangement.Top,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(
      text = "Register your shop",
      style = MaterialTheme.typography.headlineSmall,
      textAlign = TextAlign.Center,
    )
    Text(
      text = "Maharani Traders approves new retailer accounts before ordering opens.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 4.dp, bottom = 20.dp),
    )

    RegisterField(
      value = state.fullName,
      onValueChange = onFullNameChange,
      label = "Owner / contact name",
      field = RegisterViewModel.FIELD_FULL_NAME,
      errors = state.fieldErrors,
      tag = RegisterTags.FULL_NAME,
    )
    RegisterField(
      value = state.shopName,
      onValueChange = onShopNameChange,
      label = "Shop / firm name",
      field = RegisterViewModel.FIELD_SHOP_NAME,
      errors = state.fieldErrors,
      tag = RegisterTags.SHOP_NAME,
    )
    RegisterField(
      value = state.phone,
      onValueChange = onPhoneChange,
      label = "Mobile number",
      field = RegisterViewModel.FIELD_PHONE,
      errors = state.fieldErrors,
      keyboardType = KeyboardType.Phone,
      tag = RegisterTags.PHONE,
    )
    RegisterField(
      value = state.email,
      onValueChange = onEmailChange,
      label = "Email",
      field = RegisterViewModel.FIELD_EMAIL,
      errors = state.fieldErrors,
      keyboardType = KeyboardType.Email,
      tag = RegisterTags.EMAIL,
    )
    RegisterField(
      value = state.address,
      onValueChange = onAddressChange,
      label = "Shop address",
      field = RegisterViewModel.FIELD_ADDRESS,
      errors = state.fieldErrors,
      tag = RegisterTags.ADDRESS,
    )

    AreaPicker(state = state, onAreaChange = onAreaChange, onRetry = onRetryAreas)

    RegisterField(
      value = state.password,
      onValueChange = onPasswordChange,
      label = "Password (at least 8 characters)",
      field = RegisterViewModel.FIELD_PASSWORD,
      errors = state.fieldErrors,
      keyboardType = KeyboardType.Password,
      password = true,
      tag = RegisterTags.PASSWORD,
    )
    RegisterField(
      value = state.confirmPassword,
      onValueChange = onConfirmPasswordChange,
      label = "Confirm password",
      field = RegisterViewModel.FIELD_CONFIRM_PASSWORD,
      errors = state.fieldErrors,
      keyboardType = KeyboardType.Password,
      password = true,
      imeAction = ImeAction.Done,
      tag = RegisterTags.CONFIRM_PASSWORD,
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
          .testTag(RegisterTags.ERROR),
      )
    }

    Button(
      onClick = onSubmit,
      // The area must be known before the form can be sent: without it the
      // server's trigger rejects the registration.
      enabled = state.canSubmit && state.areaId.isNotBlank() && state.areasError == null,
      modifier = Modifier
        .fillMaxWidth()
        .padding(top = 20.dp)
        .testTag(RegisterTags.SUBMIT),
    ) {
      if (state.submitting) {
        CircularProgressIndicator(
          modifier = Modifier.padding(end = 8.dp),
          strokeWidth = 2.dp,
          color = MaterialTheme.colorScheme.onPrimary,
        )
      }
      Text(if (state.submitting) "Creating your account…" else "Create account")
    }

    TertiaryAction(
      label = "Back to sign in",
      onClick = onBack,
      enabled = !state.submitting,
      modifier = Modifier
        .padding(top = 8.dp)
        .testTag(RegisterTags.BACK),
    )
  }
}

@Composable
private fun AreaPicker(
  state: RegisterUiState,
  onAreaChange: (String) -> Unit,
  onRetry: () -> Unit,
) {
  Column(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
    Text(
      text = "Service area",
      style = MaterialTheme.typography.labelLarge,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    when {
      state.areasLoading -> Text(
        text = "Loading areas…",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 8.dp),
      )

      state.areasError != null -> {
        Text(
          text = "Could not load the service areas. ${state.areasError}",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.error,
          modifier = Modifier
            .padding(top = 8.dp)
            .testTag(RegisterTags.AREA_ERROR),
        )
        TertiaryAction(
          label = "Try again",
          onClick = onRetry,
          modifier = Modifier.testTag(RegisterTags.AREA_RETRY),
        )
      }

      state.areas.isEmpty() -> Text(
        text = "No service areas are open for registration right now. Please contact Maharani Traders.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
          .padding(top = 8.dp)
          .testTag(RegisterTags.AREA_ERROR),
      )

      else -> Column(modifier = Modifier.fillMaxWidth().testTag(RegisterTags.AREA_LIST)) {
        state.areas.forEach { area ->
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .selectable(
                selected = state.areaId == area.id,
                onClick = { onAreaChange(area.id) },
                role = Role.RadioButton,
              )
              .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            RadioButton(
              selected = state.areaId == area.id,
              // The whole row is the target (48 dp+), not just the radio.
              onClick = null,
            )
            Text(
              text = area.district?.let { "${area.name} — $it" } ?: area.name,
              style = MaterialTheme.typography.bodyMedium,
              modifier = Modifier.padding(start = 8.dp),
            )
          }
        }
      }
    }

    state.fieldErrors[RegisterViewModel.FIELD_AREA]?.let { message ->
      Text(
        text = message,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.padding(top = 4.dp),
      )
    }
  }
}

@Composable
private fun RegisterField(
  value: String,
  onValueChange: (String) -> Unit,
  label: String,
  field: String,
  errors: Map<String, String>,
  tag: String,
  keyboardType: KeyboardType = KeyboardType.Text,
  password: Boolean = false,
  imeAction: ImeAction = ImeAction.Next,
) {
  OutlinedTextField(
    value = value,
    onValueChange = onValueChange,
    label = { Text(label) },
    singleLine = true,
    isError = errors.containsKey(field),
    supportingText = errors[field]?.let { message -> { Text(message) } },
    visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
    keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
    modifier = Modifier
      .fillMaxWidth()
      .padding(top = 8.dp)
      .testTag(tag),
  )
}
