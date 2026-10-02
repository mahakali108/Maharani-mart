package com.maharanitraders.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.TertiaryAction

object AuthFlowTags {
  const val PENDING_TITLE = "pending_title"
  const val PENDING_START_OVER = "pending_start_over"
  const val CONFIRM_TITLE = "confirm_email_title"
}

private enum class AuthStep { LOGIN, REGISTER, PENDING_APPROVAL, CONFIRM_EMAIL }

/**
 * The signed-out experience: sign in, register, and the two honest outcomes of
 * registration (pending approval, or "confirm your email first").
 *
 * Navigation is local state rather than a nav graph on purpose: these four
 * screens are one flow with no deep links and no back stack worth preserving,
 * and a local `when` cannot render a screen the session state forbids.
 */
@Composable
fun AuthFlowScreen(
  onSignedIn: () -> Unit,
  onSignOut: () -> Unit,
  modifier: Modifier = Modifier,
) {
  var step by remember { mutableStateOf(AuthStep.LOGIN) }

  val loginViewModel: LoginViewModel = hiltViewModel()
  val registerViewModel: RegisterViewModel = hiltViewModel()
  val loginState by loginViewModel.state.collectAsStateWithLifecycle()
  val registerState by registerViewModel.state.collectAsStateWithLifecycle()

  // Both transitions below are side effects, so they run in a LaunchedEffect
  // rather than during composition: writing state (or calling back into the
  // parent) while Compose is calculating the frame can cause recomposition
  // loops and lost updates.
  LaunchedEffect(loginState.signedIn) {
    if (loginState.signedIn) onSignedIn()
  }

  LaunchedEffect(registerState.registered, registerState.requiresEmailConfirmation) {
    if (registerState.registered) {
      step = if (registerState.requiresEmailConfirmation) {
        AuthStep.CONFIRM_EMAIL
      } else {
        AuthStep.PENDING_APPROVAL
      }
    }
  }

  when (step) {
    AuthStep.LOGIN -> LoginScreen(
      state = loginState,
      onIdentifierChange = loginViewModel::onIdentifierChange,
      onPasswordChange = loginViewModel::onPasswordChange,
      onSubmit = loginViewModel::submit,
      onOpenRegister = { step = AuthStep.REGISTER },
      modifier = modifier,
    )

    AuthStep.REGISTER -> {
      RegisterScreen(
        state = registerState,
        onFullNameChange = registerViewModel::onFullNameChange,
        onShopNameChange = registerViewModel::onShopNameChange,
        onPhoneChange = registerViewModel::onPhoneChange,
        onEmailChange = registerViewModel::onEmailChange,
        onAddressChange = registerViewModel::onAddressChange,
        onPasswordChange = registerViewModel::onPasswordChange,
        onConfirmPasswordChange = registerViewModel::onConfirmPasswordChange,
        onAreaChange = registerViewModel::onAreaChange,
        onRetryAreas = registerViewModel::loadAreas,
        onSubmit = registerViewModel::submit,
        onBack = { step = AuthStep.LOGIN },
        modifier = modifier,
      )
    }

    AuthStep.PENDING_APPROVAL -> RegistrationOutcomeScreen(
      title = "Your shop is awaiting approval",
      message = "Your account was created. Maharani Traders reviews new retailer accounts before " +
        "ordering opens — you will be able to sign in and order as soon as the shop is approved.",
      tag = AuthFlowTags.PENDING_TITLE,
      onStartOver = {
        step = AuthStep.LOGIN
        onSignOut()
      },
      modifier = modifier,
    )

    AuthStep.CONFIRM_EMAIL -> RegistrationOutcomeScreen(
      title = "Confirm your email",
      message = "Your account was created. Please open the confirmation link we emailed you, then " +
        "sign in. The shop is awaiting approval and can order once it is approved.",
      tag = AuthFlowTags.CONFIRM_TITLE,
      onStartOver = {
        step = AuthStep.LOGIN
        onSignOut()
      },
      modifier = modifier,
    )
  }
}

@Composable
private fun RegistrationOutcomeScreen(
  title: String,
  message: String,
  tag: String,
  onStartOver: () -> Unit,
  modifier: Modifier = Modifier,
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
      modifier = Modifier.testTag(tag),
    )
    Text(
      text = message,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
      modifier = Modifier.padding(top = 8.dp),
    )
    TertiaryAction(
      label = "Back to sign in",
      onClick = onStartOver,
      modifier = Modifier
        .padding(top = 24.dp)
        .testTag(AuthFlowTags.PENDING_START_OVER),
    )
  }
}
