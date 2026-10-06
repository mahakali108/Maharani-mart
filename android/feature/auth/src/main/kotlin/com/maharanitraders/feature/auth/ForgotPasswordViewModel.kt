package com.maharanitraders.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.auth.AuthRepository
import com.maharanitraders.core.common.AppResult
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Everything the forgot-password screen renders, as one explicit state.
 *
 * `sent` is only ever set after the server answered `200 { ok: true }`. The
 * endpoint answers identically whether or not the address has an account, so
 * the confirmation copy must stay generic — it must not claim an email went
 * to a specific account.
 */
data class ForgotPasswordUiState(
  val email: String = "",
  val fieldError: String? = null,
  val formError: String? = null,
  val submitting: Boolean = false,
  val sent: Boolean = false,
) {
  val canSubmit: Boolean get() = !submitting && email.isNotBlank()
}

/**
 * Requests the password-reset email through the existing mobile endpoint
 * (`POST /api/mobile/v1/auth/password-reset`).
 *
 * What this ViewModel deliberately does NOT do:
 *  - it never reveals whether an address has an account — the endpoint is
 *    constant-time on purpose, and the UI keeps that property;
 *  - it never claims the reset completes in this app. Supabase delivers the
 *    recovery link to the Maharani Traders website, where the shopper chooses
 *    a new password; the screen says exactly that.
 */
@HiltViewModel
class ForgotPasswordViewModel @Inject constructor(
  private val authRepository: AuthRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(ForgotPasswordUiState())
  val state: StateFlow<ForgotPasswordUiState> = _state.asStateFlow()

  /** Pre-fill from the sign-in identifier when it looks like an email. */
  fun primeEmail(value: String) {
    if (_state.value.email.isNotEmpty() || _state.value.sent) return
    val trimmed = value.trim()
    if (AuthValidation.isEmail(trimmed)) {
      _state.update { it.copy(email = trimmed) }
    }
  }

  /**
   * Back to a blank form.
   *
   * This ViewModel is activity-scoped, so it OUTLIVES a sign-out; without this
   * reset the next account on the same device would open "Forgot password" and
   * find the previous account's "check your email" confirmation still on
   * screen. The signed-out flow calls it whenever it enters composition.
   */
  fun reset() {
    _state.update { ForgotPasswordUiState() }
  }

  fun onEmailChange(value: String) {
    _state.update { it.copy(email = value, fieldError = null, formError = null) }
  }

  fun submit() {
    // A double tap must not send the request twice: the endpoint is rate
    // limited at five requests per hour per caller.
    if (_state.value.submitting) return

    val current = _state.value
    val emailError = AuthValidation.validateRegistrationEmail(current.email.trim())
    if (emailError != null) {
      _state.update { it.copy(fieldError = emailError) }
      return
    }

    _state.update { it.copy(submitting = true, fieldError = null, formError = null) }

    viewModelScope.launch {
      when (val result = authRepository.requestPasswordReset(current.email.trim())) {
        is AppResult.Success -> _state.update { it.copy(submitting = false, sent = true) }
        is AppResult.Failure -> _state.update {
          it.copy(submitting = false, formError = result.error.message)
        }
      }
    }
  }
}
