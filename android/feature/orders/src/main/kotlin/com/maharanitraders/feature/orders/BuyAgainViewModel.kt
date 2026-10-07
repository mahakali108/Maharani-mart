package com.maharanitraders.feature.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.feature.catalog.CatalogRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What one attempted add achieved. */
data class BuyAgainLineResult(
  val packId: String,
  val productName: String,
  val quantity: Int,
  val message: String,
)

/** The Buy again screen's state. */
data class BuyAgainUiState(
  val loading: Boolean = true,
  val items: List<BuyAgainItem> = emptyList(),
  /** Rows the shopper has ticked. Defaults to every row that can be ordered. */
  val selected: Set<String> = emptySet(),
  /** Quantity entered per pack, starting at the row's suggested quantity. */
  val quantities: Map<String, Int> = emptyMap(),
  val adding: Boolean = false,
  val error: String? = null,
  val errorCode: ApiErrorCode? = null,
  val offline: Boolean = false,
  /** Summary of the last add, and the lines the server refused. */
  val resultMessage: String? = null,
  val lineResults: List<BuyAgainLineResult> = emptyList(),
) {
  val isEmpty: Boolean get() = !loading && error == null && items.isEmpty()

  /** Rows that passed revalidation and can be added. */
  val availableItems: List<BuyAgainItem>
    get() = items.filter { it.status == BuyAgainStatus.READY }

  /** Rows that cannot be ordered today, with the reason the server gave. */
  val unavailableItems: List<BuyAgainItem>
    get() = items.filter { it.status != BuyAgainStatus.READY }

  val selectedCount: Int get() = selected.count { packId -> items.any { it.packId == packId && it.status == BuyAgainStatus.READY } }
}

/**
 * Buy again: this shop's real repeat purchases, revalidated before they are
 * offered.
 *
 * THE ONE RULE THIS SCREEN EXISTS TO ENFORCE
 * A past order's price is never shown and never reused. The screen reads the
 * retailer's own order history for WHAT was bought (pack identity and piece
 * counts), then asks the catalogue for TODAY's price, minimum and availability
 * for each pack, and only offers a row the server has just priced and stocked.
 * A pack that has gone, gone out of stock, or lost its price is listed under
 * "cannot be ordered today" with the server's reason, and is never quietly
 * swapped for a different pack.
 *
 * Adding goes through the same cart endpoint every other surface uses, one line
 * at a time, so the cart's own MOQ, quantity and pack-activity rules decide —
 * and a line the cart refuses is reported with its own message instead of
 * collapsing into one generic failure.
 */
@HiltViewModel
class BuyAgainViewModel @Inject constructor(
  private val orders: CommerceRepository,
  private val catalog: CatalogRepository,
  private val cartCounts: CartCountStore,
) : ViewModel() {

  private val _state = MutableStateFlow(BuyAgainUiState())
  val state: StateFlow<BuyAgainUiState> = _state.asStateFlow()

  init {
    load()
  }

  fun load() {
    _state.update {
      it.copy(
        loading = true,
        error = null,
        errorCode = null,
        offline = false,
        resultMessage = null,
        lineResults = emptyList(),
      )
    }
    viewModelScope.launch {
      // Up to three history pages: 60 orders is enough for a shop's repeat
      // list, and the read stops as soon as the server says there is no more.
      val collected = mutableListOf<RetailerOrder>()
      var cursor: String? = null
      var failure: AppError? = null
      for (page in 0 until BUY_AGAIN_ORDER_PAGES) {
        when (val result = orders.orderHistory(cursor)) {
          is AppResult.Success -> {
            collected += result.value.orders
            if (!result.value.hasMore || result.value.nextCursor == null) break
            cursor = result.value.nextCursor
          }
          is AppResult.Failure -> {
            failure = result.error
            break
          }
        }
      }

      if (collected.isEmpty() && failure != null) {
        _state.update {
          it.copy(
            loading = false,
            error = failure!!.message,
            errorCode = (failure as? AppError.Api)?.code,
            offline = failure is AppError.Network,
          )
        }
        return@launch
      }

      val candidates = buyAgainCandidates(collected)
      val seeded = candidates.map { candidate -> BuyAgainItem(candidate = candidate) }
      _state.update { state ->
        state.copy(
          loading = false,
          items = seeded,
          error = null,
          errorCode = null,
          offline = false,
          // Nothing is selected until the rows have been revalidated: presuming
          // a selection would put out-of-stock packs in the basket.
          selected = emptySet(),
          quantities = emptyMap(),
        )
      }

      revalidate(seeded)
    }
  }

  /**
   * Read today's facts for every row, in parallel, and select the ones that
   * survived.
   *
   * A row whose read FAILED is [BuyAgainStatus.UNKNOWN], not silently dropped:
   * the shopper saw it in their history, and a blank row is more confusing than
   * one that says it could not be checked.
   */
  private suspend fun revalidate(items: List<BuyAgainItem>) {
    // One detail read per row, in parallel. The concurrent limit is the row
    // cap itself ([MAX_BUY_AGAIN_ITEMS]), so a full tray is twelve reads — well
    // inside the catalogue's per-user rate limit.
    val results = coroutineScope {
      items
        .map { item -> async { item.packId to catalog.loadProduct(item.candidate.productId) } }
        .associate { it.await() }
    }

    val revalidated = items.map { item ->
      when (val result = results[item.packId]) {
        is AppResult.Success -> revalidateBuyAgainItem(item, result.value)
        else -> item.copy(status = BuyAgainStatus.UNKNOWN)
      }
    }

    _state.update { state ->
      val ready = revalidated.filter { it.status == BuyAgainStatus.READY }
      state.copy(
        items = revalidated,
        selected = ready.map { it.packId }.toSet(),
        quantities = ready.associate { item -> item.packId to item.suggestedQuantity() },
      )
    }
  }

  fun toggleSelection(packId: String) {
    _state.update { state ->
      val item = state.items.firstOrNull { it.packId == packId } ?: return@update state
      // Only a row the server has just priced and stocked can be selected.
      if (item.status != BuyAgainStatus.READY) return@update state
      val next = if (packId in state.selected) state.selected - packId else state.selected + packId
      state.copy(selected = next)
    }
  }

  fun selectAllAvailable() {
    _state.update { state ->
      state.copy(selected = state.availableItems.map { it.packId }.toSet())
    }
  }

  fun clearSelection() {
    _state.update { it.copy(selected = emptySet()) }
  }

  /**
   * The quantity the shopper typed, kept as typed.
   *
   * The MOQ is enforced when the line is SENT (and again by the server), not by
   * silently rewriting what was typed: a stepper that jumps the number under the
   * shopper's finger is worse than a clear "minimum is 12" message on the row.
   */
  fun onQuantityChange(packId: String, raw: String) {
    val parsed = raw.filter(Char::isDigit).take(6).toIntOrNull() ?: return
    _state.update { it.copy(quantities = it.quantities + (packId to parsed)) }
  }

  /**
   * Add every selected row to the cart, one line at a time.
   *
   * A rejected line does not stop the rest: the shopper asked for six products
   * and gets the five the warehouse can still fill, told which one failed and
   * why. Lines already accepted are in the server cart, which is why the badge
   * is refreshed from the server's own response rather than counted here.
   */
  fun addSelected() {
    val current = _state.value
    if (current.adding) return
    val selections = current.items.filter { it.packId in current.selected && it.status == BuyAgainStatus.READY }
    if (selections.isEmpty()) {
      _state.update { it.copy(resultMessage = "Select at least one product that is available today.") }
      return
    }
    _state.update { it.copy(adding = true, resultMessage = null, lineResults = emptyList()) }
    viewModelScope.launch {
      val results = mutableListOf<BuyAgainLineResult>()
      var added = 0
      for (item in selections) {
        val quantity = current.quantities[item.packId] ?: item.suggestedQuantity()
        when (val result = orders.addCartLine(packId = item.packId, quantity = quantity)) {
          is AppResult.Success -> {
            cartCounts.record(result.value)
            added += 1
          }
          is AppResult.Failure -> results += BuyAgainLineResult(
            packId = item.packId,
            productName = item.candidate.productName ?: item.candidate.packName ?: "This product",
            quantity = quantity,
            message = result.error.message,
          )
        }
      }
      val skipped = selections.size - added
      _state.update {
        it.copy(
          adding = false,
          lineResults = results,
          resultMessage = when {
            added == 0 -> "Nothing could be added. The server's reasons are listed with each line."
            skipped == 0 -> "$added line${if (added == 1) "" else "s"} added to your cart at today's prices."
            else -> "$added of ${selections.size} lines added. $skipped could not be added — see the reasons below."
          },
        )
      }
    }
  }

  fun consumeResult() {
    _state.update { it.copy(resultMessage = null, lineResults = emptyList()) }
  }
}
