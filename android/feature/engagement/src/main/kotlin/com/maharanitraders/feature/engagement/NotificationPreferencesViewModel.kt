package com.maharanitraders.feature.engagement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class NotificationPreferencesUiState(
  val preferences: MobileNotificationPreferencesDto? = null,
  val loading: Boolean = true,
  val saving: Boolean = false,
  val error: String? = null,
  val message: String? = null,
)

@HiltViewModel
class NotificationPreferencesViewModel @Inject constructor(
  private val repository: RetailerUpgradeRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(NotificationPreferencesUiState())
  val state: StateFlow<NotificationPreferencesUiState> = _state.asStateFlow()

  init { load() }

  fun load() {
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadNotificationPreferences()) {
        is AppResult.Success -> _state.update { it.copy(preferences = result.value, loading = false, error = null) }
        is AppResult.Failure -> _state.update { it.copy(loading = false, error = result.error.message) }
      }
    }
  }

  fun setOrderUpdates(value: Boolean) = update { copy(orderUpdates = value) }
  fun setPaymentUpdates(value: Boolean) = update { copy(paymentUpdates = value) }
  fun setWalletUpdates(value: Boolean) = update { copy(walletUpdates = value) }
  fun setOfferUpdates(value: Boolean) = update { copy(offerUpdates = value) }

  fun save() {
    val preferences = _state.value.preferences ?: return
    if (_state.value.saving) return
    _state.update { it.copy(saving = true, error = null, message = null) }
    viewModelScope.launch {
      when (val result = repository.saveNotificationPreferences(preferences)) {
        is AppResult.Success -> _state.update { it.copy(saving = false, message = "Notification preferences saved.") }
        is AppResult.Failure -> _state.update { it.copy(saving = false, error = result.error.message) }
      }
    }
  }

  private fun update(transform: MobileNotificationPreferencesDto.() -> MobileNotificationPreferencesDto) {
    _state.update { state -> state.copy(preferences = state.preferences?.transform(), error = null, message = null) }
  }
}
