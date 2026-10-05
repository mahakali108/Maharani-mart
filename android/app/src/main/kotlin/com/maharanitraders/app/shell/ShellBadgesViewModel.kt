package com.maharanitraders.app.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.feature.engagement.ShellBadgeStore
import com.maharanitraders.feature.engagement.ShellBadges
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Feeds the shell's badge state to the authenticated shell.
 *
 * The ViewModel owns nothing but the trigger: [state] is the store's flow, because
 * the numbers are shared by the bottom bar, the masthead and the drawer, and three
 * copies of one count is how a badge starts disagreeing with the cart underneath
 * it. Refresh is driven by the shell's own moments — first frame, resume, and
 * leaving the cart or the alert feed — because the count is a server fact.
 */
@HiltViewModel
class ShellBadgesViewModel @Inject constructor(
  private val store: ShellBadgeStore,
) : ViewModel() {

  val state: StateFlow<ShellBadges> = store.state

  init {
    refresh()
  }

  fun refresh() {
    viewModelScope.launch { store.refresh() }
  }

  /** Called when the shell goes away (sign-out, expired session): no inherited counts. */
  fun clear() {
    store.clear()
  }
}
