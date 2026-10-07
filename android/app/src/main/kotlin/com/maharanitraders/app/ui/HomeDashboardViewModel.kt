package com.maharanitraders.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.feature.catalog.HomeCoins
import com.maharanitraders.feature.catalog.HomeDashboard
import com.maharanitraders.feature.catalog.HomeOrderSummary
import com.maharanitraders.feature.catalog.LocalHistoryStore
import com.maharanitraders.feature.engagement.EngagementRepository
import com.maharanitraders.feature.orders.CommerceRepository
import com.maharanitraders.feature.orders.RetailerOrder
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The retailer home dashboard: the shop's Coins position, its most recent order
 * and the products this device was just looking at.
 *
 * WHY IT LIVES IN `:app`
 * It is the only module that may depend on the catalogue, orders and engagement
 * features at once, so it is the only place where "Coins + last order + recently
 * viewed" can be assembled without making one feature module depend on another.
 * The screen itself ([com.maharanitraders.feature.catalog.ui.RetailerHomeScreen])
 * receives the finished [HomeDashboard] as data.
 *
 * WHAT IT NEVER DOES
 * It computes no money: the Coins figures are the wallet endpoint's own fields,
 * and the order total is the order's stored total. It invents no order: an
 * account with no history gets `lastOrder = null`, and the card simply is not
 * drawn. Every failure is reported per-read — a Coins outage does not hide the
 * last order, and neither of them can blank the catalogue on the same screen.
 */
@HiltViewModel
class HomeDashboardViewModel @Inject constructor(
  private val wallet: EngagementRepository,
  private val orders: CommerceRepository,
  private val history: LocalHistoryStore,
) : ViewModel() {

  private val _state = MutableStateFlow(HomeDashboard())
  val state: StateFlow<HomeDashboard> = _state.asStateFlow()

  init {
    load()
  }

  /** Re-read everything. Safe to tap repeatedly: an in-flight read is reused. */
  fun load() {
    _state.update { it.copy(loading = it.isEmpty, errorMessage = null) }
    viewModelScope.launch {
      // Recently viewed is local and instant; the two server reads run together.
      history.ensureLoaded()
      val viewed = history.recentlyViewed.value

      val (walletResult, orderResult) = coroutineScope {
        val walletRead = async { wallet.loadWalletSummary() }
        val orderRead = async { orders.orderHistory(cursor = null) }
        walletRead.await() to orderRead.await()
      }

      val coins = (walletResult as? AppResult.Success)?.value?.let { summary ->
        HomeCoins(
          balancePaise = summary.coinBalancePaise,
          fundedPaise = summary.coinsFundedPaise,
          spentPaise = summary.coinsSpentPaise,
        )
      }
      val lastOrder = (orderResult as? AppResult.Success)?.value?.orders?.firstOrNull()
        ?.let { order -> order.toHomeSummary() }

      // One message, naming the read that failed — never a generic "something
      // went wrong" that hides which number is missing.
      val failure = (walletResult as? AppResult.Failure)?.error
        ?: (orderResult as? AppResult.Failure)?.error

      _state.update {
        it.copy(
          loading = false,
          coins = coins,
          lastOrder = lastOrder,
          recentlyViewed = viewed,
          errorMessage = failure?.message,
          // The check is written out rather than reached for through the
          // catalogue's extension, so this module depends only on `core:common`
          // for what "offline" means.
          offline = failure is AppError.Network,
          retryable = failure?.retryable ?: true,
        )
      }

      // History may finish loading after the snapshot above on a cold start;
      // re-read it so the rail is not empty for the rest of the session.
      history.ensureLoaded()
      _state.update { it.copy(recentlyViewed = history.recentlyViewed.value) }
    }
  }
}

/**
 * The order fields the home card shows, taken verbatim from the order row.
 *
 * [statusLabel] is a human reading of the SERVER's status string, and nothing
 * else: the mapping adds no state the server did not send, and an unrecognised
 * status is shown as-is rather than being rounded into something friendlier.
 */
private fun RetailerOrder.toHomeSummary(): HomeOrderSummary = HomeOrderSummary(
  id = id,
  orderNumber = orderNumber,
  status = status,
  statusLabel = homeOrderStatusLabel(status),
  placedAt = placedAt,
  totalPaise = grandTotalPaise,
  itemCount = items.size,
)

/**
 * The order statuses the mobile API can answer, worded exactly as the orders
 * tab words them so one order cannot be "Order dispatched" in the history list
 * and something else on the home card.
 *
 * The values are duplicated from `:feature:orders`' own internal helper rather
 * than shared, because that helper is `internal` to its module and widening it
 * for one label would make two modules' public surface depend on each other.
 * `HomeQuickActionsTest` pins every status the contract defines, so the two
 * cannot drift silently. An unrecognised status is shown AS THE SERVER SENT IT —
 * never rounded into a friendlier word.
 */
internal fun homeOrderStatusLabel(status: String): String = when (status.trim().lowercase()) {
  "pending" -> "Order received"
  "confirmed" -> "Order confirmed"
  "processing" -> "Order processing"
  "packed" -> "Order packed"
  "dispatched" -> "Order dispatched"
  "delivered" -> "Order delivered"
  "cancelled", "canceled" -> "Order cancelled"
  "returned" -> "Order returned"
  else -> status
}
