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

/**
 * The GST invoice for one owned order.
 *
 * Every figure on this screen — the folded lines, the CGST/SGST/IGST split and
 * the totals — is returned by the server, which computed it with the same
 * helpers the web invoice prints. The app performs no tax arithmetic, which is
 * the reason the endpoint exists at all.
 */
data class InvoiceUiState(
  val loading: Boolean = true,
  val invoice: OrderInvoice? = null,
  val error: String? = null,
  val errorCode: ApiErrorCode? = null,
  val offline: Boolean = false,
)

@HiltViewModel
class InvoiceViewModel @Inject constructor(
  private val repository: CommerceRepository,
  savedStateHandle: SavedStateHandle,
) : ViewModel() {

  private val _state = MutableStateFlow(InvoiceUiState())
  val state: StateFlow<InvoiceUiState> = _state.asStateFlow()

  private val orderId: String = savedStateHandle.get<String>(OrderDetailViewModel.ARG_ORDER_ID).orEmpty()

  init {
    load()
  }

  fun load() {
    if (orderId.isBlank()) {
      _state.update {
        it.copy(loading = false, error = "This invoice could not be opened.", errorCode = ApiErrorCode.NOT_FOUND)
      }
      return
    }
    _state.update { it.copy(loading = it.invoice == null, error = null, errorCode = null) }
    viewModelScope.launch {
      when (val result = repository.orderInvoice(orderId)) {
        is AppResult.Success -> _state.update {
          it.copy(loading = false, invoice = result.value, error = null, errorCode = null, offline = false)
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
}

/**
 * The delivery record for one owned order: status timeline, what was handed
 * over, the proof the delivery captured and the server-decided return window.
 */
data class DeliveryUiState(
  val loading: Boolean = true,
  val delivery: OrderDelivery? = null,
  val error: String? = null,
  val errorCode: ApiErrorCode? = null,
  val offline: Boolean = false,
)

@HiltViewModel
class DeliveryViewModel @Inject constructor(
  private val repository: CommerceRepository,
  savedStateHandle: SavedStateHandle,
) : ViewModel() {

  private val _state = MutableStateFlow(DeliveryUiState())
  val state: StateFlow<DeliveryUiState> = _state.asStateFlow()

  private val orderId: String = savedStateHandle.get<String>(OrderDetailViewModel.ARG_ORDER_ID).orEmpty()

  init {
    load()
  }

  fun load() {
    if (orderId.isBlank()) {
      _state.update {
        it.copy(loading = false, error = "This delivery record could not be opened.", errorCode = ApiErrorCode.NOT_FOUND)
      }
      return
    }
    _state.update { it.copy(loading = it.delivery == null, error = null, errorCode = null) }
    viewModelScope.launch {
      when (val result = repository.orderDelivery(orderId)) {
        is AppResult.Success -> _state.update {
          it.copy(loading = false, delivery = result.value, error = null, errorCode = null, offline = false)
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
}
