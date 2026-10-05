package com.maharanitraders.feature.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The address book screen state. */
data class AddressBookUiState(
  val loading: Boolean = true,
  val refreshing: Boolean = false,
  val addresses: List<DeliveryAddress> = emptyList(),
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
  /** The editor sheet: null when closed, otherwise the address being written. */
  val editorId: String? = null,
  val editorOpen: Boolean = false,
  val draft: AddressDraft = AddressDraft.EMPTY,
  val fieldErrors: Map<String, String> = emptyMap(),
  val saving: Boolean = false,
  /** The address a delete confirmation is open for. */
  val confirmDeleteId: String? = null,
  /** The address with a set-default / delete call in flight. */
  val busyId: String? = null,
  val actionMessage: String? = null,
) {
  val isEmpty: Boolean get() = !loading && errorMessage == null && addresses.isEmpty()
  val editingExisting: Boolean get() = editorOpen && editorId != null
}

/**
 * The address book: the retailer's saved delivery addresses, in the server's
 * order (default first).
 *
 * Every rule comes from the server twice over: [AddressRules] mirrors
 * `lib/retailer/address-shared.ts` so a typo is caught before a round trip, and
 * the API validates the same schema again — the device can never be the
 * authority on what an address is. Ownership is the session's; a stale id that
 * is not the caller's answers `404` and surfaces as an error rather than
 * silently editing somebody else's row.
 *
 * The list is ALWAYS the server's response to the write (every address endpoint
 * answers with the refreshed list), so default-exclusivity and ordering can
 * never drift from what the database decided.
 */
@HiltViewModel
class AddressBookViewModel @Inject constructor(
  private val repository: CommerceRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(AddressBookUiState())
  val state: StateFlow<AddressBookUiState> = _state.asStateFlow()

  init {
    load()
  }

  fun load() {
    val hasContent = _state.value.addresses.isNotEmpty()
    _state.update {
      if (hasContent) it.copy(refreshing = true, errorMessage = null, offline = false)
      else it.copy(loading = true, errorMessage = null, offline = false)
    }
    viewModelScope.launch {
      when (val result = repository.loadAddresses()) {
        is AppResult.Success -> _state.update {
          it.copy(
            loading = false,
            refreshing = false,
            addresses = result.value,
            errorMessage = null,
            offline = false,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            loading = false,
            refreshing = false,
            errorMessage = result.error.message,
            offline = result.error is AppError.Network,
            retryable = result.error.retryable,
          )
        }
      }
    }
  }

  fun retry() = load()

  /** Open the editor for a NEW address. */
  fun openCreate() {
    _state.update {
      it.copy(editorOpen = true, editorId = null, draft = AddressDraft.EMPTY, fieldErrors = emptyMap())
    }
  }

  /** Open the editor for a SAVED address. The shop-address pseudo row is not editable. */
  fun openEdit(addressId: String) {
    val address = _state.value.addresses.firstOrNull { it.id == addressId } ?: return
    if (!address.isEditable) return
    _state.update {
      it.copy(
        editorOpen = true,
        editorId = addressId,
        draft = address.toDraft(),
        fieldErrors = emptyMap(),
      )
    }
  }

  fun closeEditor() {
    if (_state.value.saving) return
    _state.update { it.copy(editorOpen = false, editorId = null, fieldErrors = emptyMap()) }
  }

  /** Replace the whole draft (one call per keystroke from the screen's fields). */
  fun updateDraft(draft: AddressDraft) {
    _state.update { it.copy(draft = draft, fieldErrors = emptyMap()) }
  }

  /**
   * Validate locally, then let the server decide. The client-side pass exists to
   * answer instantly with the SAME message the server would send; it is not a
   * substitute for the server's check.
   */
  fun save() {
    val current = _state.value
    if (current.saving) return
    val errors = AddressRules.validate(current.draft)
    if (errors.isNotEmpty()) {
      _state.update { it.copy(fieldErrors = errors) }
      return
    }

    _state.update { it.copy(saving = true, fieldErrors = emptyMap(), actionMessage = null) }
    viewModelScope.launch {
      val editingId = current.editorId
      val result = if (editingId == null) {
        repository.createAddress(current.draft)
      } else {
        repository.updateAddress(editingId, current.draft)
      }
      when (result) {
        is AppResult.Success -> _state.update {
          it.copy(
            saving = false,
            editorOpen = false,
            editorId = null,
            addresses = result.value,
            actionMessage = if (editingId == null) "Address saved." else "Address updated.",
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(saving = false, actionMessage = result.error.message)
        }
      }
    }
  }

  /** Ask before deleting: a delivery address is not a preference toggle. */
  fun requestDelete(addressId: String) {
    _state.update { it.copy(confirmDeleteId = addressId) }
  }

  fun cancelDelete() {
    _state.update { it.copy(confirmDeleteId = null) }
  }

  fun confirmDelete() {
    val addressId = _state.value.confirmDeleteId ?: return
    if (_state.value.busyId != null) return
    _state.update { it.copy(confirmDeleteId = null, busyId = addressId, actionMessage = null) }
    viewModelScope.launch {
      when (val result = repository.deleteAddress(addressId)) {
        is AppResult.Success -> _state.update {
          it.copy(busyId = null, addresses = result.value, actionMessage = "Address deleted.")
        }
        is AppResult.Failure -> _state.update {
          it.copy(busyId = null, actionMessage = result.error.message)
        }
      }
    }
  }

  fun setDefault(addressId: String) {
    if (_state.value.busyId != null) return
    _state.update { it.copy(busyId = addressId, actionMessage = null) }
    viewModelScope.launch {
      when (val result = repository.setDefaultAddress(addressId)) {
        is AppResult.Success -> _state.update {
          it.copy(busyId = null, addresses = result.value, actionMessage = "Default address updated.")
        }
        is AppResult.Failure -> _state.update {
          it.copy(busyId = null, actionMessage = result.error.message)
        }
      }
    }
  }

  fun consumeActionMessage() {
    _state.update { it.copy(actionMessage = null) }
  }
}
