package com.maharanitraders.feature.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One quick-order row's in-flight quantity edit, keyed by pack id. */
data class QuickOrderQuantity(
  val packId: String,
  val quantity: Int,
)

data class QuickOrderUiState(
  val term: String = "",
  val searched: Boolean = false,
  val searching: Boolean = false,
  val products: List<QuickOrderProduct> = emptyList(),
  val searchError: String? = null,
  val offline: Boolean = false,
  /** Quantity the shopper typed per pack; MOQ is the starting point. */
  val quantities: Map<String, Int> = emptyMap(),
  /** Packs with an add in flight; their Add button shows progress. */
  val adding: Set<String> = emptySet(),
  val bulkRaw: String = "",
  val bulkMatching: Boolean = false,
  val bulkMatches: List<BulkMatchLine> = emptyList(),
  val bulkError: String? = null,
  val bulkAdding: Boolean = false,
  /** Chosen pack + quantity per matched line index. */
  val bulkChoices: Map<Int, QuickOrderQuantity> = emptyMap(),
  val message: String? = null,
) {
  val hasResults: Boolean get() = products.isNotEmpty()
  val noResults: Boolean get() = searched && !searching && products.isEmpty() && searchError == null
  val cartLinesAdded: Int get() = adding.size
}

/**
 * Quick order: the native equivalent of the web quick-order page.
 *
 * The business rules are the server's and the web page's: search active products
 * by name (30 results), add a pack by quantity, or paste a list and let the
 * server resolve each line to real packs. The ViewModel invents no prices and no
 * ordering model; every add goes through [CommerceRepository.addCartLine], the
 * same MOQ/availability-revalidating path the cart uses, and the fresh cart
 * snapshot is handed to the ONE cart badge store.
 */
@HiltViewModel
class QuickOrderViewModel @Inject constructor(
  private val repository: QuickOrderRepository,
  private val cart: CommerceRepository,
  private val cartCounts: CartCountStore,
) : ViewModel() {

  private val _state = MutableStateFlow(QuickOrderUiState())
  val state: StateFlow<QuickOrderUiState> = _state.asStateFlow()

  private var searchJob: Job? = null

  fun onTermChange(term: String) {
    _state.update { it.copy(term = term) }
  }

  /** Submit the search — the explicit action the web form's button performs. */
  fun search() {
    val term = _state.value.term.trim()
    if (term.isEmpty()) {
      // An empty quick-order search clears the results rather than dumping the
      // whole catalogue: this screen is for restocking known items.
      _state.update {
        it.copy(searched = false, searching = false, products = emptyList(), searchError = null)
      }
      return
    }

    searchJob?.cancel()
    _state.update { it.copy(searching = true, searchError = null, offline = false) }
    searchJob = viewModelScope.launch {
      when (val result = repository.search(term)) {
        is AppResult.Success -> _state.update {
          it.copy(
            searching = false,
            searched = true,
            products = result.value,
            // Start every pack at its MOQ, the smallest order the server accepts.
            quantities = it.quantities + result.value
              .flatMap { product -> product.packs }
              .associate { pack -> pack.packId to (it.quantities[pack.packId] ?: pack.moq) },
            searchError = null,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            searching = false,
            searched = true,
            products = emptyList(),
            searchError = result.error.message,
            offline = result.error is com.maharanitraders.core.common.AppError.Network,
          )
        }
      }
    }
  }

  fun onQuantityChange(pack: QuickOrderPack, raw: String) {
    val quantity = raw.filter(Char::isDigit).take(6).toIntOrNull() ?: pack.moq
    _state.update { it.copy(quantities = it.quantities + (pack.packId to quantity)) }
  }

  /** Add one pack at the quantity shown. The server revalidates everything. */
  fun addToCart(pack: QuickOrderPack) {
    if (pack.packId in _state.value.adding) return
    val quantity = _state.value.quantities[pack.packId] ?: pack.moq
    _state.update { it.copy(adding = it.adding + pack.packId, message = null) }
    viewModelScope.launch {
      when (val result = cart.addCartLine(packId = pack.packId, quantity = quantity)) {
        is AppResult.Success -> {
          cartCounts.record(result.value)
          _state.update { it.copy(adding = it.adding - pack.packId, message = "Added to cart.") }
        }
        is AppResult.Failure -> _state.update {
          it.copy(adding = it.adding - pack.packId, message = result.error.message)
        }
      }
    }
  }

  // ------------------------------------------------------------------ bulk

  fun onBulkRawChange(raw: String) {
    _state.update { it.copy(bulkRaw = raw, bulkError = null) }
  }

  /** Resolve the pasted list. Nothing is added until the shopper confirms. */
  fun matchBulkLines() {
    val raw = _state.value.bulkRaw
    if (raw.isBlank()) {
      _state.update { it.copy(bulkError = "Paste at least one line, e.g. `2 x tea 250g`.", bulkMatches = emptyList()) }
      return
    }
    if (_state.value.bulkMatching) return
    _state.update { it.copy(bulkMatching = true, bulkError = null) }
    viewModelScope.launch {
      when (val result = repository.matchLines(raw)) {
        is AppResult.Success -> _state.update { current ->
          current.copy(
            bulkMatching = false,
            bulkMatches = result.value,
            // Default each matched line to its parsed quantity, or the first
            // candidate pack's MOQ when the paste had no quantity.
            bulkChoices = result.value.mapIndexedNotNull { index, line ->
              val pack = line.matches.firstOrNull() ?: return@mapIndexedNotNull null
              index to QuickOrderQuantity(pack.packId, line.quantity ?: pack.moq)
            }.toMap(),
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(bulkMatching = false, bulkMatches = emptyList(), bulkError = result.error.message)
        }
      }
    }
  }

  fun onBulkChoiceChange(index: Int, pack: BulkMatchPack, raw: String) {
    val quantity = raw.filter(Char::isDigit).take(6).toIntOrNull() ?: pack.moq
    _state.update { it.copy(bulkChoices = it.bulkChoices + (index to QuickOrderQuantity(pack.packId, quantity))) }
  }

  fun onBulkPackSelect(index: Int, pack: BulkMatchPack) {
    val quantity = _state.value.bulkChoices[index]?.quantity ?: pack.moq
    _state.update { it.copy(bulkChoices = it.bulkChoices + (index to QuickOrderQuantity(pack.packId, quantity))) }
  }

  /**
   * Add every matched line that has a pack chosen. Lines are added one at a
   * time through the cart endpoint so a single rejected line does not hide the
   * fate of the others: the message reports how many actually landed.
   */
  fun addBulkMatches() {
    if (_state.value.bulkAdding) return
    val state = _state.value
    val selections = state.bulkMatches
      .mapIndexedNotNull { index, line ->
        if (!line.matched) return@mapIndexedNotNull null
        state.bulkChoices[index]
      }
    if (selections.isEmpty()) {
      _state.update { it.copy(bulkError = "No matched lines to add.") }
      return
    }

    _state.update { it.copy(bulkAdding = true, bulkError = null, message = null) }
    viewModelScope.launch {
      var added = 0
      var failure: String? = null
      for (selection in selections) {
        when (val result = cart.addCartLine(packId = selection.packId, quantity = selection.quantity)) {
          is AppResult.Success -> {
            cartCounts.record(result.value)
            added += 1
          }
          is AppResult.Failure -> {
            if (failure == null) failure = result.error.message
          }
        }
      }
      _state.update {
        it.copy(
          bulkAdding = false,
          message = when {
            added == selections.size -> "Added $added line${if (added == 1) "" else "s"} to the cart."
            added > 0 -> "Added $added of ${selections.size} lines. $failure"
            else -> failure ?: "Nothing could be added."
          },
        )
      }
    }
  }

  fun consumeMessage() {
    _state.update { it.copy(message = null) }
  }

  fun clearBulk() {
    _state.update { it.copy(bulkRaw = "", bulkMatches = emptyList(), bulkChoices = emptyMap(), bulkError = null) }
  }
}
