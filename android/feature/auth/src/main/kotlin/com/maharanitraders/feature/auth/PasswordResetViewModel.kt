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

data class PasswordResetUiState(
  val email: String = "",
  val fieldError: String? = null,
  val message: String? = null,
  val submitting: Boolean = false,
  val submitted: Boolean = false,
) {
  val canSubmit: Boolean get() = !submitting && AuthValidation.isEmail(email.trim())
}

@HiltViewModel
class PasswordResetViewModel @Inject constructor(
  private val authRepository: AuthRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(PasswordResetUiState())
  val state: StateFlow<PasswordResetUiState> = _state.asStateFlow()

  fun onEmailChange(value: String) {
    _state.update { it.copy(email = value, fieldError = null, message = null, submitted = false) }
  }

  fun submit() {
    if (_state.value.submitting) return
    val current = _state.value
    if (!AuthValidation.isEmail(current.email.trim())) {
      _state.update { it.copy(fieldError = "Enter a valid email address.", message = null) }
      return
    }
    _state.update { it.copy(submitting = true, fieldError = null, message = null) }
    viewModelScope.launch {
      when (val result = authRepository.requestPasswordReset(current.email.trim())) {
        is AppResult.Success -> _state.update {
          it.copy(
            submitting = false,
            submitted = true,
            message = "If an account uses this email, password reset instructions will be sent.",
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(submitting = false, message = result.error.message)
        }
      }
    }
  }

  fun reset() {
    _state.update { PasswordResetUiState(email = it.email) }
  }
}
