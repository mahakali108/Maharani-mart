package com.maharanitraders.feature.catalog

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.ProductPackDetail
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The product detail state.
 *
 * [selectedPackId] is a UI selection over the packs the SERVER returned. It can
 * only ever name a pack in [ProductDetail.packs]; there is no way for the screen
 * to introduce a pack the server did not price.
 */
data class ProductDetailUiState(
  val loading: Boolean = true,
  val refreshing: Boolean = false,
  val detail: ProductDetail? = null,
  val selectedPackId: String? = null,
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
  /** True when the server answered 404: the product is gone, not merely failing. */
  val notFound: Boolean = false,
) {
  val selectedPack: ProductPackDetail?
    get() {
      val packs = detail?.packs.orEmpty()
      return packs.firstOrNull { it.packId == selectedPackId }
        ?: packs.firstOrNull { it.selected }
        ?: packs.firstOrNull()
    }

  /** Every gallery image for the pack currently on screen, then the product's. */
  val gallery: List<String>
    get() = selectedPack?.images?.takeIf { it.isNotEmpty() } ?: detail?.images.orEmpty()
}

/**
 * One product, priced per pack by the server.
 *
 * This screen displays money; it does not compute any. The per-piece rate, the
 * GST-inclusive line total at the MOQ and the slab table all arrive from the
 * same engine checkout uses, so what the shopper reads here is what an order
 * would be charged. Nothing here is sent back to the server as a price.
 *
 * The Phase E add-to-cart action is owned by `CartCheckoutViewModel` in the
 * authenticated shell; this catalogue ViewModel continues to carry no cart,
 * price-submission or checkout state of its own.
 */
@HiltViewModel
class ProductDetailViewModel @Inject constructor(
  private val repository: CatalogRepository,
  savedStateHandle: SavedStateHandle,
) : ViewModel() {

  private val productId: String = savedStateHandle.get<String>(ARG_PRODUCT_ID).orEmpty()

  private val _state = MutableStateFlow(ProductDetailUiState())
  val state: StateFlow<ProductDetailUiState> = _state.asStateFlow()

  init {
    load()
  }

  fun load() {
    if (productId.isBlank()) {
      _state.update {
        it.copy(
          loading = false,
          notFound = true,
          retryable = false,
          errorMessage = "This product could not be opened.",
        )
      }
      return
    }

    _state.update {
      if (it.detail != null) it.copy(refreshing = true, errorMessage = null, offline = false)
      else it.copy(loading = true, errorMessage = null, offline = false)
    }

    viewModelScope.launch {
      when (val result = repository.loadProduct(productId)) {
        is AppResult.Success -> _state.update {
          it.copy(
            loading = false,
            refreshing = false,
            detail = result.value,
            notFound = false,
            errorMessage = null,
            offline = false,
            selectedPackId = it.selectedPackId ?: result.value.selectedPack?.packId,
          )
        }

        is AppResult.Failure -> _state.update { state ->
          val notFound = (result.error as? com.maharanitraders.core.common.AppError.Api)
            ?.code == ApiErrorCode.NOT_FOUND
          state.copy(
            loading = false,
            refreshing = false,
            notFound = notFound,
            errorMessage = result.error.message,
            offline = result.error.isOffline,
            retryable = result.error.retryable,
          )
        }
      }
    }
  }

  /** Select one of the packs the server returned. Unknown ids are ignored. */
  fun selectPack(packId: String) {
    val known = _state.value.detail?.packs?.any { it.packId == packId } == true
    if (!known) return
    _state.update { it.copy(selectedPackId = packId) }
  }

  companion object {
    const val ARG_PRODUCT_ID = "productId"
  }
}
