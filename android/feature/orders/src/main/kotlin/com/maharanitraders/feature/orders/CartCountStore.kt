package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.SessionScopedStore
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * What the cart badge is allowed to say.
 *
 * [lineCount] is null until the server has answered once. That matters: the
 * badge must show NOTHING rather than a confident "0" on a cold start, because
 * a shopkeeper with a full cart would read the empty badge as "my cart is
 * gone".
 */
data class CartBadgeState(
  val lineCount: Int? = null,
  val itemCount: Int = 0,
)

/**
 * The ONE source of the cart badge count.
 *
 * It holds a projection — the line count and piece total — of the SAME
 * `GET /api/mobile/v1/cart` response the cart screen renders, never a second
 * cart: the lines, prices and coupon live only in the cart screen's state, and
 * every successful cart response (a read, an add, a quantity change, a removal)
 * is handed here through [record]. So the badge and the cart screen are always
 * counting the same server rows.
 *
 * The count is deliberately NOT computed on the device from the loaded page:
 * the server's `lineCount` is the same number the web shell badges, and a local
 * recount would drift the moment pagination or a filter entered the picture.
 */
@Singleton
class CartCountStore @Inject constructor(
  private val repository: CommerceRepository,
) : SessionScopedStore {

  private val _state = MutableStateFlow(CartBadgeState())
  val state: StateFlow<CartBadgeState> = _state.asStateFlow()

  /** Record the counts the server just returned with a cart snapshot. */
  fun record(snapshot: CartSnapshot) {
    _state.update {
      CartBadgeState(
        lineCount = snapshot.lineCount.coerceAtLeast(0),
        itemCount = snapshot.itemCount.coerceAtLeast(0),
      )
    }
  }

  /**
   * Re-read the server's cart counts (app start, opening the drawer, returning
   * to the shell). Failures leave the last known count in place: a stale badge
   * is honest until the next successful read, whereas a cleared one is a lie.
   */
  suspend fun refresh(): AppResult<CartSnapshot> {
    val result = repository.loadCart()
    if (result is AppResult.Success) record(result.value)
    return result
  }

  /** Session ended: nothing about the previous account may survive. */
  fun clear() {
    _state.value = CartBadgeState()
  }

  /**
   * Session-scoped contract: the badge is the previous account's cart line
   * count, so it is dropped with the session. `null` again means "not known
   * yet", which is the honest badge for an account whose cart has not been
   * read.
   */
  override suspend fun onSessionEnded() {
    clear()
  }
}
