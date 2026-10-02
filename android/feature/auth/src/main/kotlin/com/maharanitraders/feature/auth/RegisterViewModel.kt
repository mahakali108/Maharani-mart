package com.maharanitraders.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.auth.RegistrationRequest
import com.maharanitraders.core.auth.RegistrationResult
import com.maharanitraders.core.auth.SessionController
import com.maharanitraders.core.common.AppError
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One selectable service area, as sent by `GET /api/mobile/v1/areas`. */
data class AreaOption(
  val id: String,
  val name: String,
  val district: String?,
)

data class RegisterUiState(
  val fullName: String = "",
  val shopName: String = "",
  val phone: String = "",
  val email: String = "",
  val address: String = "",
  val password: String = "",
  val confirmPassword: String = "",
  val areaId: String = "",
  val areas: List<AreaOption> = emptyList(),
  val areasLoading: Boolean = false,
  val areasError: String? = null,
  val fieldErrors: Map<String, String> = emptyMap(),
  val formError: String? = null,
  val submitting: Boolean = false,
  /** Set when the server accepted the registration — the shop is pending approval. */
  val registered: Boolean = false,
  /** True when Supabase requires the confirmation email before the first sign-in. */
  val requiresEmailConfirmation: Boolean = false,
) {
  val canSubmit: Boolean get() = !submitting
}

/**
 * Retailer registration.
 *
 * Notes on honesty:
 *  - the success state is "registered, awaiting approval" — never "you're in";
 *  - the area list comes from the server. If it cannot be loaded the form says
 *    so and disables submission instead of offering a made-up area;
 *  - server field errors replace local ones, because the server is the authority
 *    on whether a phone number is already taken.
 */
@HiltViewModel
class RegisterViewModel @Inject constructor(
  private val session: SessionController,
  private val areaDirectory: AreaDirectory,
) : ViewModel() {

  private val _state = MutableStateFlow(RegisterUiState())
  val state: StateFlow<RegisterUiState> = _state.asStateFlow()

  init {
    loadAreas()
  }

  fun loadAreas() {
    if (_state.value.areasLoading) return
    _state.update { it.copy(areasLoading = true, areasError = null) }

    viewModelScope.launch {
      when (val result = areaDirectory.load()) {
        is AreaDirectoryResult.Loaded -> _state.update {
          it.copy(areasLoading = false, areas = result.areas, areasError = null)
        }
        is AreaDirectoryResult.Failed -> _state.update {
          it.copy(areasLoading = false, areasError = result.message)
        }
      }
    }
  }

  fun onFullNameChange(value: String) = update(FIELD_FULL_NAME, value)
  fun onShopNameChange(value: String) = update(FIELD_SHOP_NAME, value)
  fun onPhoneChange(value: String) = update(FIELD_PHONE, value)
  fun onEmailChange(value: String) = update(FIELD_EMAIL, value)
  fun onAddressChange(value: String) = update(FIELD_ADDRESS, value)
  fun onPasswordChange(value: String) = update(FIELD_PASSWORD, value)
  fun onConfirmPasswordChange(value: String) = update(FIELD_CONFIRM_PASSWORD, value)

  fun onAreaChange(areaId: String) {
    _state.update { it.copy(areaId = areaId, fieldErrors = it.fieldErrors - FIELD_AREA) }
  }

  private fun update(field: String, value: String) {
    _state.update { current ->
      val next = when (field) {
        FIELD_FULL_NAME -> current.copy(fullName = value)
        FIELD_SHOP_NAME -> current.copy(shopName = value)
        FIELD_PHONE -> current.copy(phone = value)
        FIELD_EMAIL -> current.copy(email = value)
        FIELD_ADDRESS -> current.copy(address = value)
        FIELD_PASSWORD -> current.copy(password = value)
        else -> current.copy(confirmPassword = value)
      }
      next.copy(fieldErrors = next.fieldErrors - field, formError = null)
    }
  }

  fun submit() {
    if (_state.value.submitting) return

    val current = _state.value
    val errors = buildMap {
      AuthValidation.validateFullName(current.fullName)?.let { put(FIELD_FULL_NAME, it) }
      AuthValidation.validateShopName(current.shopName)?.let { put(FIELD_SHOP_NAME, it) }
      AuthValidation.validatePhone(current.phone)?.let { put(FIELD_PHONE, it) }
      AuthValidation.validateRegistrationEmail(current.email)?.let { put(FIELD_EMAIL, it) }
      AuthValidation.validateAddress(current.address)?.let { put(FIELD_ADDRESS, it) }
      AuthValidation.validateAreaId(current.areaId)?.let { put(FIELD_AREA, it) }
      AuthValidation.validateNewPassword(current.password)?.let { put(FIELD_PASSWORD, it) }
      AuthValidation.validateConfirmation(current.password, current.confirmPassword)
        ?.let { put(FIELD_CONFIRM_PASSWORD, it) }
    }
    if (errors.isNotEmpty()) {
      _state.update { it.copy(fieldErrors = errors) }
      return
    }

    _state.update { it.copy(submitting = true, formError = null, fieldErrors = emptyMap()) }

    viewModelScope.launch {
      val result = session.registerRetailer(
        RegistrationRequest(
          fullName = current.fullName.trim(),
          shopName = current.shopName.trim(),
          // The canonical form is what the database stores; the server
          // normalizes again, but sending the normalized value keeps the
          // duplicate-phone check meaningful.
          phone = AuthValidation.normalizePhone(current.phone) ?: current.phone.trim(),
          email = current.email.trim().lowercase(),
          areaId = current.areaId.trim(),
          address = current.address.trim(),
          password = current.password,
        )
      )

      when (result) {
        is RegistrationResult.Registered -> _state.update {
          it.copy(
            submitting = false,
            registered = true,
            requiresEmailConfirmation = result.requiresEmailConfirmation,
            // Do not keep credentials in memory after a successful submit.
            password = "",
            confirmPassword = "",
          )
        }

        is RegistrationResult.Failed -> _state.update {
          // The server's field errors win over anything the form guessed.
          val serverFields = (result.error as? AppError.Api)?.fieldErrors.orEmpty()

          it.copy(
            submitting = false,
            fieldErrors = serverFields,
            // A 409 with field details is shown on the field itself; otherwise
            // the server's message is the form-level error.
            formError = if (serverFields.isEmpty()) result.error.message else null,
          )
        }
      }
    }
  }

  companion object {
    const val FIELD_FULL_NAME = "fullName"
    const val FIELD_SHOP_NAME = "shopName"
    const val FIELD_PHONE = "phone"
    const val FIELD_EMAIL = "email"
    const val FIELD_ADDRESS = "address"
    const val FIELD_PASSWORD = "password"
    const val FIELD_CONFIRM_PASSWORD = "confirmPassword"
    const val FIELD_AREA = "areaId"
  }
}
