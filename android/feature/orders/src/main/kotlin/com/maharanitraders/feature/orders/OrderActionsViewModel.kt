package com.maharanitraders.feature.orders

import androidx.lifecycle.SavedStateHandle
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

data class OrderActionsUiState(
  val busy: Boolean = false,
  val error: String? = null,
  val message: String? = null,
  val completedAction: String? = null,
)

@HiltViewModel
class OrderActionsViewModel @Inject constructor(
  private val repository: RetailerOrderActionsRepository,
  savedStateHandle: SavedStateHandle,
) : ViewModel() {
  private val orderId: String = savedStateHandle.get<String>(OrderDetailViewModel.ARG_ORDER_ID).orEmpty()
  private val _state = MutableStateFlow(OrderActionsUiState())
  val state: StateFlow<OrderActionsUiState> = _state.asStateFlow()

  fun cancelOrder(reason: String) {
    if (orderId.isBlank() || _state.value.busy) return
    _state.update { it.copy(busy = true, error = null, message = null, completedAction = null) }
    viewModelScope.launch {
      when (val result = repository.cancelOrder(orderId, reason.trim())) {
        is AppResult.Success -> _state.update { it.copy(busy = false, message = "Order cancelled. Any Coins reversal is recorded by the server.", completedAction = "cancel") }
        is AppResult.Failure -> _state.update { it.copy(busy = false, error = result.error.message) }
      }
    }
  }

  fun requestReturn(reason: String) {
    val text = reason.trim()
    if (orderId.isBlank() || _state.value.busy) return
    if (text.isEmpty()) {
      _state.update { it.copy(error = "Enter a reason for the return request.") }
      return
    }
    _state.update { it.copy(busy = true, error = null, message = null, completedAction = null) }
    viewModelScope.launch {
      when (val result = repository.requestReturn(orderId, text)) {
        is AppResult.Success -> _state.update { it.copy(busy = false, message = "Return request submitted. The team will review it.", completedAction = "return") }
        is AppResult.Failure -> _state.update { it.copy(busy = false, error = result.error.message) }
      }
    }
  }

  fun clearFeedback() = _state.update { it.copy(error = null, message = null) }
}
