package com.maharanitraders.feature.catalog

import com.maharanitraders.core.designsystem.theme.AccentTone

/**
 * The retailer home dashboard, assembled from the endpoints that already exist.
 *
 * WHAT THIS IS
 * The home screen's discovery payload (`GET /api/mobile/v1/home` plus one
 * newest-first catalogue batch) stays exactly where it was, in [HomeUiState].
 * This type carries the SECOND kind of home content — the shop's own numbers and
 * the shopper's own history:
 *
 *   - [coins]         → `GET /api/mobile/v1/wallet` (the server's coin summary);
 *   - [lastOrder]     → `GET /api/mobile/v1/orders` (the caller's own history);
 *   - [recentlyViewed] → device-local ids of products already opened, never a
 *     price and never a stock claim (see [LocalHistoryStore]).
 *
 * WHY IT IS SEPARATE FROM [HomeUiState]
 * The discovery payload and the dashboard have different failure modes: a Coins
 * outage must not blank the shop, and a catalogue outage must not hide the
 * order the retailer is waiting for. Each section renders only what the server
 * (or the device history) actually returned, and says nothing when it has
 * nothing — there is no fallback number anywhere in this file.
 *
 * The type lives in `:feature:catalog` because that is where [RetailerHomeScreen]
 * is drawn from; `:app` FILLS it (it is the only module that may depend on the
 * wallet, orders and catalogue features at once), so neither feature module has
 * to depend on the other.
 */
data class HomeDashboard(
  /** True until the first dashboard read has answered. */
  val loading: Boolean = true,
  val coins: HomeCoins? = null,
  val offers: List<HomeOffer> = emptyList(),
  val lastOrder: HomeOrderSummary? = null,
  val recentlyViewed: List<RecentlyViewedProduct> = emptyList(),
  /**
   * What this shop orders most, from its own order history. Empty when the
   * account has none, and the rail is then simply not drawn.
   */
  val frequentlyOrdered: List<HomeFrequentlyOrdered> = emptyList(),
  /**
   * A dashboard read that failed. Non-null does NOT hide the discovery content:
   * the home shows the note and keeps the shop on screen.
   */
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
) {
  /** Nothing at all was returned: the sections below are all omitted. */
  val isEmpty: Boolean
    get() = coins == null && lastOrder == null && recentlyViewed.isEmpty() && frequentlyOrdered.isEmpty()
}

/**
 * The shop's coin position, in paise, exactly as the server reported it.
 *
 * `balancePaise` is the clamped `max(0, funded − spent)` figure the wallet
 * screen shows — never a negative, because a shopkeeper does not "owe coins".
 */
data class HomeCoins(
  val balancePaise: Long,
  val fundedPaise: Long,
  val spentPaise: Long,
)

/**
 * The caller's most recent order, as the history endpoint returned it.
 *
 * [id] is the destination a "Reorder" tap opens: the order detail screen, where
 * the real reorder replays the stored pieces through the cart API so today's
 * price, stock and MOQ are what decide — this summary is a shortcut to that
 * flow, never a copy of it.
 */
/**
 * One product this shop buys repeatedly, derived from its OWN order history.
 *
 * Only identity travels here (and the count of past orders that contained it) —
 * no price and no stock, because a figure remembered on the device would be
 * yesterday's by the time it is read. Tapping opens the product, where the
 * current rate and availability arrive from the server.
 */
data class HomeFrequentlyOrdered(
  val productId: String,
  val name: String,
  val packName: String?,
  /** Past orders (of the pages read) that contained this pack. */
  val timesOrdered: Int,
)

data class HomeOrderSummary(
  val id: String,
  val orderNumber: String,
  val status: String,
  val statusLabel: String,
  val placedAt: String,
  val totalPaise: Long,
  val itemCount: Int,
)

/**
 * The glyph a shortcut tile draws.
 *
 * An enum rather than a route string so the screen keeps no knowledge of the
 * shell's route table (which lives in `:app`, above this module) and the shell
 * keeps no knowledge of iconography: the tile is assembled from `(route, label,
 * icon, tone)`, and adding a shortcut is a one-line change in the shell.
 */
enum class HomeQuickActionIcon {
  SHOP,
  CATEGORY,
  BRAND,
  ORDERS,
  CART,
  REORDER,
  FAVORITES,
  QUICK_ORDER,
  SAVED_CARTS,
  COINS,
  COUPONS,
  SUPPORT,
  NOTIFICATIONS,
  REPORTS,
}

/**
 * One shortcut tile on the home screen.
 *
 * [route] is a route id of the shell's destination catalog; the shell builds the
 * list from the destinations the SERVER-verified session can actually open, so a
 * tile is only ever rendered when tapping it lands on a real screen. That is why
 * this is data and not a hardcoded `when` inside the screen: the home cannot
 * advertise a workspace the account does not have.
 */
data class HomeQuickAction(
  val route: String,
  val label: String,
  val icon: HomeQuickActionIcon,
  val tone: AccentTone,
)

/** Admin scheme identity/dates only: no inferred product discount or eligibility. */
data class HomeOffer(val id: String, val title: String, val description: String?, val endsAt: String)
