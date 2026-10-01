package com.maharanitraders.core.common

/**
 * Offline policy, expressed as executable rules rather than documentation.
 *
 * The objective is explicit: the app must never promise fully offline ordering,
 * and queued financial or inventory mutations must never be replayed blindly
 * after reconnecting. [mayReplayAutomatically] therefore returns `false` for
 * EVERY action — including read-only ones, which are simply re-fetched.
 *
 * Callers ask these questions instead of hardcoding assumptions per screen, so
 * a new screen cannot accidentally invent an offline checkout.
 */
enum class AppAction(
  /** The server must validate this action before it can be shown as done. */
  val requiresServerVerification: Boolean,
) {
  /** Read-only views may be rendered from safe local cache. */
  VIEW_CACHED_CATALOG(false),
  VIEW_CACHED_ORDERS(false),

  /** Cart edits stay local until checkout re-prices and re-validates. */
  EDIT_LOCAL_CART(false),

  /** Everything below changes money, stock or order state on the server. */
  PLACE_ORDER(true),
  CANCEL_ORDER(true),
  APPLY_COUPON(true),
  REQUEST_RETURN(true),
  ADJUST_STOCK(true),
  RECORD_COLLECTION(true),
  MANAGE_CATALOG(true),
  MANAGE_RETAILERS(true),
  RUN_RETENTION(true),
}

object OfflinePolicy {

  fun isAllowedOffline(action: AppAction): Boolean = !action.requiresServerVerification

  /**
   * Queued mutations are never sent automatically. The user re-confirms
   * against fresh server state instead, which is what keeps a retry from
   * becoming a second order or a double stock decrement.
   */
  fun mayReplayAutomatically(@Suppress("UNUSED_PARAMETER") action: AppAction): Boolean = false

  fun requiresFreshServerCheck(action: AppAction): Boolean = action.requiresServerVerification
}
