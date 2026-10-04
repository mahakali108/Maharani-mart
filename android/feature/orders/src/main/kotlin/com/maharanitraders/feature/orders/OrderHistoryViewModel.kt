package com.maharanitraders.feature.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Server-paginated retailer order history; entries are never synthesized locally. */
data class OrderHistoryUiState(
  val loading: Boolean = true,
  val loadingMore: Boolean = false,
  val refreshing: Boolean = false,
  val orders: List<RetailerOrder> = emptyList(),
  val nextCursor: String? = null,
  val hasMore: Boolean = false,
  val error: String? = null,
  val errorCode: ApiErrorCode? = null,
  val offline: Boolean = false,
)

@HiltViewModel
class OrderHistoryViewModel @Inject constructor(
  private val repository: CommerceRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(OrderHistoryUiState())
  val state: StateFlow<OrderHistoryUiState> = _state.asStateFlow()

  init {
    refresh()
  }

  fun refresh() {
    val current = _state.value
    if (current.refreshing || current.loadingMore) return
    val hasCurrent = current.orders.isNotEmpty()
    _state.update {
      it.copy(
        loading = !hasCurrent,
        refreshing = hasCurrent,
        error = null,
        errorCode = null,
      )
    }
    viewModelScope.launch {
      when (val result = repository.orderHistory(cursor = null)) {
        is AppResult.Success -> _state.update {
          it.copy(
            loading = false,
            refreshing = false,
            orders = result.value.orders,
            nextCursor = result.value.nextCursor,
            hasMore = result.value.hasMore,
            error = null,
            errorCode = null,
            offline = false,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            loading = false,
            refreshing = false,
            error = result.error.message,
            errorCode = (result.error as? AppError.Api)?.code,
            offline = result.error is AppError.Network,
          )
        }
      }
    }
  }

  fun loadMore() {
    val current = _state.value
    val cursor = current.nextCursor ?: return
    if (!current.hasMore || current.loadingMore || current.loading || current.refreshing) return
    _state.update { it.copy(loadingMore = true, error = null, errorCode = null) }
    viewModelScope.launch {
      when (val result = repository.orderHistory(cursor)) {
        is AppResult.Success -> _state.update { state ->
          val seen = state.orders.mapTo(mutableSetOf()) { order -> order.id }
          val appended = result.value.orders.filter { order -> seen.add(order.id) }
          state.copy(
            loadingMore = false,
            orders = state.orders + appended,
            nextCursor = result.value.nextCursor,
            hasMore = result.value.hasMore,
            error = null,
            errorCode = null,
            offline = false,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            loadingMore = false,
            error = result.error.message,
            errorCode = (result.error as? AppError.Api)?.code,
            offline = result.error is AppError.Network,
          )
        }
      }
    }
  }
}
