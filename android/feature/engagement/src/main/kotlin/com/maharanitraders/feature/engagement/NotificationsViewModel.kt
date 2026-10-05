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
  /**
   * Show only unread alerts. The filter is the SERVER's (`unreadOnly=1`), so an
   * unread-only view is a real query and not the loaded page minus its read rows
   * — which would silently hide alerts the shopper has not seen yet.
   */
  val unreadOnly: Boolean = false,
  /**
   * A read-state write that failed. Kept apart from [errorMessage] on purpose:
   * the feed itself loaded fine, and wiping it because marking one row read hit a
   * timeout would throw away the alerts the shopper came to read.
   */
  val actionMessage: String? = null,
) {
  val unreadCount: Int get() = items.count { !it.isRead }
}

@HiltViewModel
class NotificationsViewModel @Inject constructor(
  private val repository: EngagementRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(NotificationsUiState())
  val state: StateFlow<NotificationsUiState> = _state.asStateFlow()

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
      when (val result = repository.loadNotifications(cursor = null, unreadOnly = _state.value.unreadOnly)) {
        is AppResult.Success -> _state.update {
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
      when (val result = repository.loadNotifications(
        cursor = cursor,
        unreadOnly = _state.value.unreadOnly,
      )) {
        is AppResult.Success -> _state.update { state ->
          val seen = state.items.map { it.id }.toSet()
          state.copy(
            loadingMore = false,
            items = state.items + result.value.items.filterNot { it.id in seen },
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

  /** Switch between the whole feed and the unread ones. A no-op when unchanged. */
  fun setUnreadOnly(unreadOnly: Boolean) {
    if (_state.value.unreadOnly == unreadOnly) return
    _state.update {
      it.copy(
        unreadOnly = unreadOnly,
        // A different filter is a different result set: restarting with it empty
        // is honest, whereas filtering the old page in place would lie about both.
        items = emptyList(),
        nextCursor = null,
        hasMore = false,
        errorMessage = null,
        actionMessage = null,
      )
    }
    load()
  }

  /**
   * Mark one alert read — the tap that opens it, exactly as the web list behaves.
   *
   * The write goes to the same batch endpoint the "mark all read" shortcut uses,
   * with one id, and only the server's success flips the row: a read state the
   * device assumed would disagree with every other signed-in surface.
   */
  fun markRead(id: String) {
    val target = _state.value.items.firstOrNull { it.id == id } ?: return
    if (target.isRead) return
    viewModelScope.launch {
      when (repository.markNotificationsRead(listOf(id))) {
        is AppResult.Success -> _state.update { state ->
          state.copy(
            items = state.items.map { if (it.id == id) it.copy(isRead = true) else it },
            actionMessage = null,
          )
        }

        is AppResult.Failure -> _state.update { it.copy(actionMessage = READ_FAILED) }
      }
    }
  }

  fun markAllRead() {
    val unread = _state.value.items.filter { !it.isRead }
    if (unread.isEmpty()) return
    viewModelScope.launch {
      when (repository.markNotificationsRead(unread.map { it.id })) {
        is AppResult.Success -> _state.update { state ->
          state.copy(
            items = state.items.map { if (it.isRead) it else it.copy(isRead = true) },
            actionMessage = null,
          )
        }

        is AppResult.Failure -> _state.update { it.copy(actionMessage = READ_FAILED) }
      }
    }
  }

  /** The unread filter is what an alert's read state is measured against. */
  private companion object {
    const val READ_FAILED = "Could not update this alert. Check your connection and try again."
  }
}
