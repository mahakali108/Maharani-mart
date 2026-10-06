package com.maharanitraders.feature.orders

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

data class SavedCartsUiState(
  val savedCarts: List<SavedCart> = emptyList(),
  val loading: Boolean = true,
  val savingKey: String? = null,
  val createName: String = "Restock list",
  val renameId: String? = null,
  val renameName: String = "",
  val error: String? = null,
  val message: String? = null,
)

@HiltViewModel
class SavedCartsViewModel @Inject constructor(
  private val repository: SavedCartsRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(SavedCartsUiState())
  val state: StateFlow<SavedCartsUiState> = _state.asStateFlow()
  init { load() }

  fun load() {
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadSavedCarts()) {
        is AppResult.Success -> _state.update { it.copy(savedCarts = result.value, loading = false, error = null) }
        is AppResult.Failure -> _state.update { it.copy(loading = false, error = result.error.message) }
      }
    }
  }

  fun onCreateName(value: String) = _state.update { it.copy(createName = value.take(60), error = null) }
  fun onRenameName(value: String) = _state.update { it.copy(renameName = value.take(60), error = null) }
  fun beginRename(cart: SavedCart) = _state.update { it.copy(renameId = cart.id, renameName = cart.name, error = null) }
  fun cancelRename() = _state.update { it.copy(renameId = null, renameName = "") }

  fun saveCurrentCart() {
    val name = _state.value.createName.trim()
    if (name.isEmpty()) { _state.update { it.copy(error = "Enter a name for this saved cart.") }; return }
    perform("save", { repository.saveCurrentCart(name) }, onSuccess = {
      _state.update { it.copy(createName = "Restock list", message = "Cart saved. Prices and stock will be checked when you restore it.") }
    })
  }

  fun renameCart(id: String) {
    val name = _state.value.renameName.trim()
    if (name.isEmpty()) { _state.update { it.copy(error = "Enter a name for this saved cart.") }; return }
    perform("rename:$id", { repository.renameSavedCart(id, name) }, onSuccess = {
      _state.update { it.copy(renameId = null, renameName = "", message = "Saved cart renamed.") }
    })
  }

  fun deleteCart(id: String) {
    perform("delete:$id", { repository.deleteSavedCart(id) }, onSuccess = { _state.update { it.copy(message = "Saved cart deleted.") } })
  }

  fun restoreCart(id: String) {
    performResult("restore:$id", { repository.restoreSavedCart(id) }) { result ->
      val suffix = if (result.skippedCount > 0) " ${result.skippedCount} item(s) were skipped because current availability or minimums changed." else ""
      _state.update { it.copy(message = "${result.restoredCount} item(s) restored to your live cart.$suffix") }
    }
  }

  fun saveForLater(cartItemId: String, onSaved: () -> Unit) {
    perform("save-for-later:$cartItemId", { repository.saveForLater(cartItemId) }, onSuccess = {
      _state.update { it.copy(message = "Item saved for later.") }
      onSaved()
    })
  }

  fun deleteItem(itemId: String) {
    perform("delete-item:$itemId", { repository.deleteSavedItem(itemId) }, onSuccess = { _state.update { it.copy(message = "Saved item removed.") } })
  }

  fun restoreItem(itemId: String) {
    performResult("restore-item:$itemId", { repository.restoreSavedItem(itemId) }) { result ->
      val suffix = if (result.skippedCount > 0) " The item was skipped because current availability or minimums changed." else ""
      _state.update { it.copy(message = "${result.restoredCount} item(s) restored to your live cart.$suffix") }
    }
  }

  private fun perform(key: String, request: suspend () -> com.maharanitraders.core.common.AppResult<Unit>, onSuccess: () -> Unit = {}, refreshAfter: Boolean = true) {
    if (_state.value.savingKey != null) return
    _state.update { it.copy(savingKey = key, error = null, message = null) }
    viewModelScope.launch {
      when (val result = request()) {
        is AppResult.Success -> {
          _state.update { it.copy(savingKey = null) }
          onSuccess()
          if (refreshAfter) load()
        }
        is AppResult.Failure -> _state.update { it.copy(savingKey = null, error = result.error.message) }
      }
    }
  }

  private fun <T> performResult(key: String, request: suspend () -> AppResult<T>, onSuccess: (T) -> Unit) {
    if (_state.value.savingKey != null) return
    _state.update { it.copy(savingKey = key, error = null, message = null) }
    viewModelScope.launch {
      when (val result = request()) {
        is AppResult.Success -> {
          _state.update { it.copy(savingKey = null) }
          onSuccess(result.value)
          load()
        }
        is AppResult.Failure -> _state.update { it.copy(savingKey = null, error = result.error.message) }
      }
    }
  }
}
