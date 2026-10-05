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
)

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
      when (val result = repository.loadNotifications(cursor = null, unreadOnly = false)) {
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

  fun markAllRead() {
    val unread = _state.value.items.filter { !it.isRead }
    if (unread.isEmpty()) return
    viewModelScope.launch {
      when (repository.markNotificationsRead(unread.map { it.id })) {
        is AppResult.Success -> _state.update { state ->
          state.copy(items = state.items.map { if (it.isRead) it else it.copy(isRead = true) })
        }
        is AppResult.Failure -> { /* silently fail — the user can retry */ }
      }
    }
  }
}