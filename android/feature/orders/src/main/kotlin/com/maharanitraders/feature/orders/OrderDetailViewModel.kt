package com.maharanitraders.feature.orders

import androidx.lifecycle.SavedStateHandle
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

/** State of one order's detail screen. */
data class OrderDetailUiState(
  val loading: Boolean = true,
  val order: RetailerOrder? = null,
  val error: String? = null,
  val errorCode: ApiErrorCode? = null,
  val offline: Boolean = false,
  /** True while lines are being replayed into the server cart. */
  val reorderInProgress: Boolean = false,
  /** Set the moment a reorder succeeds, so the screen can open the cart once. */
  val reorderCompleted: Boolean = false,
  val reorderAddedCount: Int = 0,
  val reorderError: String? = null,
) {
  val hasOrder: Boolean get() = order != null

  val canReorder: Boolean
    get() = (order?.reorderableItems?.isNotEmpty() == true) && !reorderInProgress
}

/**
 * One owned order, read from `GET /orders/{id}` — the server's own record, with
 * its status history and this order's Coins movement.
 *
 * The screen shows what the server returned and computes nothing: not a total,
 * not a tax figure, not a delivered quantity. A reorder is a replay of the
 * order's stored piece counts into the real cart, where the server re-prices
 * and re-validates every line.
 */
@HiltViewModel
class OrderDetailViewModel @Inject constructor(
  private val repository: CommerceRepository,
  private val cartCountStore: CartCountStore,
  savedStateHandle: SavedStateHandle,
) : ViewModel() {

  private val _state = MutableStateFlow(OrderDetailUiState())
  val state: StateFlow<OrderDetailUiState> = _state.asStateFlow()

  private val orderId: String = savedStateHandle.get<String>(ARG_ORDER_ID).orEmpty()

  init {
    load()
  }

  fun load() {
    if (orderId.isBlank()) {
      _state.update {
        it.copy(loading = false, error = "This order could not be opened.", errorCode = ApiErrorCode.NOT_FOUND)
      }
      return
    }
    _state.update { it.copy(loading = it.order == null, error = null, errorCode = null) }
    viewModelScope.launch {
      when (val result = repository.orderDetail(orderId)) {
        is AppResult.Success -> _state.update {
          it.copy(loading = false, order = result.value, error = null, errorCode = null, offline = false)
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            loading = false,
            error = result.error.message,
            errorCode = (result.error as? AppError.Api)?.code,
            offline = result.error is AppError.Network,
          )
        }
      }
    }
  }

  /**
   * Replays this order's lines into the cart.
   *
   * A failure is reported as it happened: the lines the server already accepted
   * stay in the cart, so the badge is refreshed from the server instead of the
   * app pretending the attempt did nothing.
   */
  fun reorder() {
    val order = _state.value.order ?: return
    if (_state.value.reorderInProgress) return
    val intents = order.reorderableItems.map { item ->
      CartLineIntent(packId = item.packId.orEmpty(), quantity = item.reorderPieces)
    }
    if (intents.isEmpty()) {
      _state.update {
        it.copy(reorderError = "This order has no purchaseable lines to reorder.")
      }
      return
    }
    _state.update { it.copy(reorderInProgress = true, reorderError = null, reorderCompleted = false) }
    viewModelScope.launch {
      when (val result = repository.reorderLines(intents)) {
        is AppResult.Success -> {
          result.value.cart?.let(cartCountStore::record)
          _state.update {
            it.copy(
              reorderInProgress = false,
              reorderCompleted = true,
              reorderAddedCount = result.value.addedCount,
              reorderError = null,
            )
          }
        }
        is AppResult.Failure -> {
          // Some lines may already be in the server cart: re-read the counts so
          // the badge tells the truth, then report the failure.
          cartCountStore.refresh()
          _state.update {
            it.copy(reorderInProgress = false, reorderError = result.error.message)
          }
        }
      }
    }
  }

  /** Consumed once by the screen after it has navigated to the cart. */
  fun consumeReorderCompletion() {
    _state.update { it.copy(reorderCompleted = false) }
  }

  companion object {
    /** Navigation argument carrying the order id into this screen. */
    const val ARG_ORDER_ID = "orderId"
  }
}
