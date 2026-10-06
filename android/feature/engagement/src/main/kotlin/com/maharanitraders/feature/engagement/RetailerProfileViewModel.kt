package com.maharanitraders.feature.engagement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RetailerProfileUiState(
  val profile: RetailerProfile? = null,
  val shopName: String = "",
  val address: String = "",
  val fullName: String = "",
  val phone: String = "",
  val loading: Boolean = true,
  val saving: String? = null,
  val error: String? = null,
  val message: String? = null,
)

@HiltViewModel
class RetailerProfileViewModel @Inject constructor(
  private val repository: RetailerUpgradeRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(RetailerProfileUiState())
  val state: StateFlow<RetailerProfileUiState> = _state.asStateFlow()

  init { load() }

  fun load() {
    if (_state.value.loading && _state.value.profile != null) return
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadProfile()) {
        is AppResult.Success -> _state.update {
          it.copy(
            profile = result.value,
            shopName = result.value.shopName,
            address = result.value.address,
            fullName = result.value.fullName,
            phone = result.value.phone,
            loading = false,
            error = null,
          )
        }
        is AppResult.Failure -> _state.update { it.copy(loading = false, error = result.error.message) }
      }
    }
  }

  fun onShopName(value: String) = _state.update { it.copy(shopName = value, error = null, message = null) }
  fun onAddress(value: String) = _state.update { it.copy(address = value, error = null, message = null) }
  fun onFullName(value: String) = _state.update { it.copy(fullName = value, error = null, message = null) }
  fun onPhone(value: String) = _state.update { it.copy(phone = value, error = null, message = null) }

  fun saveShop() {
    val current = _state.value
    if (current.saving != null) return
    val name = current.shopName.trim()
    val address = current.address.trim()
    if (name.length !in 2..120 || address.length > 500) {
      _state.update { it.copy(error = "Enter a shop name (2–120 characters) and address (up to 500 characters).") }
      return
    }
    save("shop") { repository.updateShopProfile(name, address) }
  }

  fun saveContact() {
    val current = _state.value
    if (current.saving != null) return
    val name = current.fullName.trim()
    val phone = current.phone.trim()
    if (name.length !in 2..120 || phone.length !in 10..15 || !phone.matches(Regex("^[0-9+\\-\\s]+$"))) {
      _state.update { it.copy(error = "Enter a name (2–120 characters) and valid phone number.") }
      return
    }
    save("contact") { repository.updateContactProfile(name, phone) }
  }

  private fun save(section: String, request: suspend () -> com.maharanitraders.core.common.AppResult<Unit>) {
    _state.update { it.copy(saving = section, error = null, message = null) }
    viewModelScope.launch {
      when (val result = request()) {
        is AppResult.Success -> {
          _state.update { it.copy(saving = null, message = if (section == "shop") "Shop details saved." else "Contact details saved.") }
          load()
        }
        is AppResult.Failure -> _state.update { it.copy(saving = null, error = result.error.message) }
      }
    }
  }
}
