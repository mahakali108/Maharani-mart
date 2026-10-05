package com.maharanitraders.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.feature.engagement.UnreadStore
import com.maharanitraders.feature.orders.CartCountStore
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * The shell's two badges: saved cart lines and unread notifications.
 *
 * This ViewModel owns no state of its own — it observes the two shared stores
 * and asks them to refresh when the shell appears. That is deliberate: a badge
 * counter implemented in the shell AND in the screens that change it is the
 * classic way a badge starts disagreeing with the screen behind it.
 *
 * Null means "not known yet": the bar renders no bubble rather than a zero,
 * because a confident empty badge over a full cart is a worse lie than no badge
 * at all. [onSignOut] clears both so nothing about the previous account
 * survives to the next one.
 */
@HiltViewModel
class ShellBadgesViewModel @Inject constructor(
  private val cartCounts: CartCountStore,
  private val unread: UnreadStore,
) : ViewModel() {

  val cartLineCount: StateFlow<Int?> = cartCounts.state
    .map { it.lineCount }
    .stateIn(viewModelScope, SharingStarted.Eagerly, cartCounts.state.value.lineCount)

  val unreadCount: StateFlow<Int?> = unread.unreadCount

  /** Read both counts once when the signed-in shell appears. */
  fun refresh() {
    viewModelScope.launch { cartCounts.refresh() }
    viewModelScope.launch { unread.refresh() }
  }

  /** Session ended: clear both badges. */
  fun onSignOut() {
    cartCounts.clear()
    unread.clear()
  }
}
