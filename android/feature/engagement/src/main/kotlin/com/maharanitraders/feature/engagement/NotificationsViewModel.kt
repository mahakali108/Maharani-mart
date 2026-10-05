package com.maharanitraders.feature.engagement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class NotificationsUiState(
  val loading: Boolean = true,
  val items: List<AppNotification> = emptyList(),
  val nextCursor: String? = null,
  val hasMore: Boolean = false,
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val loadingMore: Boolean = false,
  val refreshing: Boolean = false,
  /** True while a mark-read request is in flight. */
  val markingRead: Boolean = false,
  /** Message from a failed mark-read, for a snackbar. */
  val actionMessage: String? = null,
) {

  /**
   * Unread notifications among the pages that have been LOADED.
   *
   * Only a fallback for the moment before the server's exact total arrives
   * (`UnreadStore`); the screen prefers the server number and says "N+" while
   * it only knows this floor.
   */
  val unreadLoaded: Int get() = items.count { !it.isRead }

}

@HiltViewModel
class NotificationsViewModel @Inject constructor(
  private val repository: EngagementRepository,
  /** The shared badge source; this screen keeps no unread count of its own. */
  private val unread: UnreadStore,
) : ViewModel() {

  private val _state = MutableStateFlow(NotificationsUiState())
  val state: StateFlow<NotificationsUiState> = _state.asStateFlow()

  /** Observed by the shell badge; the screen does not duplicate the count. */
  val unreadCount: StateFlow<Int?> = unread.unreadCount

  init {
    load()
  }

  fun load() {
    val refresh = _state.value.items.isNotEmpty()
    _state.update {
      if (refresh) it.copy(refreshing = true, errorMessage = null)
      else it.copy(loading = true, errorMessage = null)
    }
    viewModelScope.launch {
      when (val result = repository.loadNotifications(cursor = null, unreadOnly = false)) {
        is AppResult.Success -> {
          unread.record(result.value.unreadCount)
          _state.update {
            it.copy(
              loading = false,
              refreshing = false,
              items = result.value.items,
              nextCursor = result.value.nextCursor,
              hasMore = result.value.hasMore,
              errorMessage = null,
              offline = false,
            )
          }
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            loading = false,
            refreshing = false,
            errorMessage = result.error.message,
            offline = result.error is AppError.Network,
          )
        }
      }
    }
  }

  fun loadMore() {
    val cursor = _state.value.nextCursor ?: return
    if (_state.value.loadingMore) return
    _state.update { it.copy(loadingMore = true) }
    viewModelScope.launch {
      when (val result = repository.loadNotifications(cursor = cursor, unreadOnly = false)) {
        is AppResult.Success -> _state.update { state ->
          state.copy(
            loadingMore = false,
            items = state.items + result.value.items,
            nextCursor = result.value.nextCursor,
            hasMore = result.value.hasMore,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(loadingMore = false, errorMessage = result.error.message)
        }
      }
    }
  }

  /**
   * Mark the loaded notifications read.
   *
   * Only the notifications the app has actually loaded can be sent, because
   * the endpoint takes explicit ids. A failure is REPORTED: a silently
   * swallowed one leaves "3 unread" on screen with no explanation, and the
   * shopkeeper taps again forever.
   */
  fun markAllRead() {
    val unreadItems = _state.value.items.filter { !it.isRead }
    if (unreadItems.isEmpty() || _state.value.markingRead) return

    _state.update { it.copy(markingRead = true, actionMessage = null) }
    viewModelScope.launch {
      when (val result = repository.markNotificationsRead(unreadItems.map { it.id })) {
        is AppResult.Success -> if (result.value == unreadItems.size) {
          // Only the shared store's count moves; the screen keeps no copy.
          unread.applyMarkedRead(result.value)
          _state.update { state ->
            state.copy(
              markingRead = false,
              items = state.items.map { if (it.isRead) it else it.copy(isRead = true) },
            )
          }
        } else {
          // The server marked a different number than was asked for and only it
          // knows which, so re-read the feed rather than guess at the rest.
          _state.update { it.copy(markingRead = false) }
          load()
        }

        is AppResult.Failure -> _state.update {
          it.copy(markingRead = false, actionMessage = result.error.message)
        }
      }
    }
  }

  fun consumeActionMessage() {
    _state.update { it.copy(actionMessage = null) }
  }
}