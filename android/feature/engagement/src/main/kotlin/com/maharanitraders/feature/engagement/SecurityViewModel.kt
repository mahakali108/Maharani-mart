package com.maharanitraders.feature.engagement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.auth.AuthRepository
import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.network.dto.MobileAccountRequestDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SecurityUiState(
  val currentPassword: String = "",
  val newPassword: String = "",
  val confirmPassword: String = "",
  val passwordSaving: Boolean = false,
  val accountRequests: List<MobileAccountRequestDto> = emptyList(),
  val requestsLoading: Boolean = true,
  val requestSaving: Boolean = false,
  val requestNote: String = "",
  val signingOutEverywhere: Boolean = false,
  val error: String? = null,
  val message: String? = null,
)

@HiltViewModel
class SecurityViewModel @Inject constructor(
  private val authRepository: AuthRepository,
  private val sessionController: SessionController,
  private val repository: RetailerUpgradeRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(SecurityUiState())
  val state: StateFlow<SecurityUiState> = _state.asStateFlow()
  init { loadRequests() }

  fun onCurrentPassword(value: String) = _state.update { it.copy(currentPassword = value, error = null, message = null) }
  fun onNewPassword(value: String) = _state.update { it.copy(newPassword = value, error = null, message = null) }
  fun onConfirmPassword(value: String) = _state.update { it.copy(confirmPassword = value, error = null, message = null) }
  fun onRequestNote(value: String) = _state.update { it.copy(requestNote = value.take(500), error = null, message = null) }

  fun changePassword() {
    val current = _state.value
    if (current.passwordSaving) return
    val error = when {
      current.currentPassword.isEmpty() -> "Enter your current password."
      current.newPassword.length < 8 -> "New password must be at least 8 characters."
      current.confirmPassword.isEmpty() -> "Confirm your new password."
      current.newPassword != current.confirmPassword -> "New passwords do not match."
      else -> null
    }
    if (error != null) {
      _state.update { it.copy(error = error, message = null) }
      return
    }
    _state.update { it.copy(passwordSaving = true, error = null, message = null) }
    viewModelScope.launch {
      when (val result = authRepository.changePassword(current.currentPassword, current.newPassword, current.confirmPassword)) {
        is AppResult.Success -> _state.update {
          it.copy(
            currentPassword = "",
            newPassword = "",
            confirmPassword = "",
            passwordSaving = false,
            message = "Password changed. Use the new password the next time you sign in.",
          )
        }
        is AppResult.Failure -> _state.update { it.copy(passwordSaving = false, error = result.error.message) }
      }
    }
  }

  fun loadRequests() {
    _state.update { it.copy(requestsLoading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadAccountRequests()) {
        is AppResult.Success -> _state.update { it.copy(accountRequests = result.value, requestsLoading = false) }
        is AppResult.Failure -> _state.update { it.copy(requestsLoading = false, error = result.error.message) }
      }
    }
  }

  fun submitAccountRequest(requestType: String) {
    val current = _state.value
    if (current.requestSaving) return
    _state.update { it.copy(requestSaving = true, error = null, message = null) }
    viewModelScope.launch {
      when (val result = repository.createAccountRequest(requestType, current.requestNote.trim())) {
        is AppResult.Success -> _state.update {
          it.copy(
            requestSaving = false,
            requestNote = "",
            accountRequests = listOf(result.value) + it.accountRequests,
            message = "Request submitted for staff review. Your account remains active until the team completes it.",
          )
        }
        is AppResult.Failure -> _state.update { it.copy(requestSaving = false, error = result.error.message) }
      }
    }
  }

  fun signOutEverywhere(onSignedOut: () -> Unit) {
    if (_state.value.signingOutEverywhere) return
    _state.update { it.copy(signingOutEverywhere = true, error = null, message = null) }
    viewModelScope.launch {
      when (val result = authRepository.revokeAllSessions()) {
        is AppResult.Success -> {
          sessionController.signOut()
          onSignedOut()
        }
        is AppResult.Failure -> _state.update {
          it.copy(signingOutEverywhere = false, error = "Could not revoke sessions: ${result.error.message}")
        }
      }
    }
  }
}
