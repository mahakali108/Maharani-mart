package com.maharanitraders.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.auth.AuthRepository
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Everything the security screen renders, as one explicit state.
 *
 * The password is only ever held here, is cleared the moment the server has
 * answered, and is never logged, cached or stored.
 */
data class ChangePasswordUiState(
  val password: String = "",
  val confirmPassword: String = "",
  /** Field errors, keyed by field name (`password`, `confirmPassword`). */
  val fieldErrors: Map<String, String> = emptyMap(),
  /** A message about the submission as a whole (policy, offline, …). */
  val formError: String? = null,
  val submitting: Boolean = false,
  /** Set once the server confirmed the change. */
  val updated: Boolean = false,
) {
  val canSubmit: Boolean get() = !submitting && password.isNotEmpty() && confirmPassword.isNotEmpty()
}

/**
 * Change the signed-in account's password through the existing authenticated
 * endpoint (`POST /api/mobile/v1/auth/password-update`).
 *
 * The server performs the change with the CALLER'S OWN bearer token against
 * GoTrue — this ViewModel sends the new password to no other place, decides no
 * entitlement, and never invents success: `updated` is only set after the
 * endpoint answered `200 { ok: true }`. A server-side validation rejection
 * (weak password, rate limit, expired session) is shown as the server's own
 * message; the fields are cleared only on success.
 */
@HiltViewModel
class ChangePasswordViewModel @Inject constructor(
  private val authRepository: AuthRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(ChangePasswordUiState())
  val state: StateFlow<ChangePasswordUiState> = _state.asStateFlow()

  fun onPasswordChange(value: String) {
    _state.update {
      it.copy(password = value, fieldErrors = it.fieldErrors - FIELD_PASSWORD, formError = null)
    }
  }

  fun onConfirmPasswordChange(value: String) {
    _state.update {
      it.copy(confirmPassword = value, fieldErrors = it.fieldErrors - FIELD_CONFIRM, formError = null)
    }
  }

  fun submit() {
    // Guards against a double tap producing two password changes.
    if (_state.value.submitting) return

    val current = _state.value
    val passwordError = AuthValidation.validateNewPassword(current.password)
    val confirmError = AuthValidation.validateConfirmation(current.password, current.confirmPassword)
    val fieldErrors = buildMap {
      passwordError?.let { put(FIELD_PASSWORD, it) }
      confirmError?.let { put(FIELD_CONFIRM, it) }
    }
    if (fieldErrors.isNotEmpty()) {
      _state.update { it.copy(fieldErrors = fieldErrors) }
      return
    }

    _state.update { it.copy(submitting = true, fieldErrors = emptyMap(), formError = null) }

    viewModelScope.launch {
      when (
        val result = authRepository.updatePassword(
          password = current.password,
          confirmPassword = current.confirmPassword,
        )
      ) {
        is AppResult.Success -> _state.update {
          it.copy(
            submitting = false,
            updated = true,
            // Nothing keeps the new password in memory once the server accepted it.
            password = "",
            confirmPassword = "",
          )
        }

        is AppResult.Failure -> {
          // The server answers `validation_failed` with per-field messages
          // (e.g. GoTrue's password policy); those go under the fields, not
          // into a generic banner.
          val serverFields = (result.error as? AppError.Api)?.fieldErrors.orEmpty()
          if (serverFields.isNotEmpty()) {
            _state.update { it.copy(submitting = false, fieldErrors = serverFields) }
          } else {
            _state.update { it.copy(submitting = false, formError = result.error.message) }
          }
        }
      }
    }
  }

  /** After a successful change, going back clears the confirmation surface. */
  fun acknowledgeUpdated() {
    _state.update { it.copy(updated = false) }
  }

  companion object {
    const val FIELD_PASSWORD = "password"
    const val FIELD_CONFIRM = "confirmPassword"
  }
}
