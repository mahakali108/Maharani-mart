package com.maharanitraders.feature.engagement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.network.dto.MobileSupportTicketDetailDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SupportUiState(
  val tickets: List<MobileSupportTicketDto> = emptyList(),
  val cursor: String? = null,
  val hasMore: Boolean = false,
  val statusFilter: String? = null,
  val loading: Boolean = true,
  val loadingMore: Boolean = false,
  val saving: Boolean = false,
  val error: String? = null,
  val message: String? = null,
  val selectedTicketId: String? = null,
  val detail: MobileSupportTicketDetailDto? = null,
  val detailLoading: Boolean = false,
  val isCreating: Boolean = false,
  val subject: String = "",
  val topic: String = "other",
  val priority: String = "normal",
  val description: String = "",
  val supportOrders: List<SupportOrderOption> = emptyList(),
  val selectedOrderId: String? = null,
  val orderOptionsLoading: Boolean = false,
  val orderOptionsError: String? = null,
  val reply: String = "",
)

@HiltViewModel
class SupportViewModel @Inject constructor(
  private val repository: RetailerUpgradeRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(SupportUiState())
  val state: StateFlow<SupportUiState> = _state.asStateFlow()
  init { refresh() }

  fun refresh() {
    _state.update { it.copy(loading = true, error = null, cursor = null, tickets = emptyList(), hasMore = false) }
    loadPage(cursor = null, append = false)
  }

  fun loadMore() {
    val current = _state.value
    if (!current.hasMore || current.loadingMore || current.loading) return
    loadPage(current.cursor, append = true)
  }

  fun setStatusFilter(status: String?) {
    if (_state.value.statusFilter == status) return
    _state.update { it.copy(statusFilter = status) }
    refresh()
  }

  private fun loadPage(cursor: String?, append: Boolean) {
    _state.update { if (append) it.copy(loadingMore = true, error = null) else it.copy(loading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadSupportTickets(cursor, _state.value.statusFilter)) {
        is AppResult.Success -> _state.update { state ->
          val combined = if (append) (state.tickets + result.value.tickets).distinctBy { it.id } else result.value.tickets
          state.copy(
            tickets = combined,
            cursor = result.value.nextCursor,
            hasMore = result.value.hasMore,
            loading = false,
            loadingMore = false,
            error = null,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(loading = false, loadingMore = false, error = result.error.message)
        }
      }
    }
  }

  fun openTicket(ticketId: String) {
    _state.update { it.copy(selectedTicketId = ticketId, detail = null, detailLoading = true, error = null, isCreating = false) }
    viewModelScope.launch {
      when (val result = repository.loadSupportTicket(ticketId)) {
        is AppResult.Success -> _state.update { it.copy(detail = result.value, detailLoading = false) }
        is AppResult.Failure -> _state.update { it.copy(detailLoading = false, error = result.error.message) }
      }
    }
  }

  fun closeDetail() = _state.update { it.copy(selectedTicketId = null, detail = null, reply = "", error = null) }
  fun openCreate() {
    _state.update {
      it.copy(
        isCreating = true,
        error = null,
        message = null,
        supportOrders = emptyList(),
        selectedOrderId = null,
        orderOptionsLoading = true,
        orderOptionsError = null,
      )
    }
    viewModelScope.launch {
      when (val result = repository.loadSupportOrders()) {
        is AppResult.Success -> _state.update {
          it.copy(supportOrders = result.value, orderOptionsLoading = false, orderOptionsError = null)
        }
        is AppResult.Failure -> _state.update {
          it.copy(orderOptionsLoading = false, orderOptionsError = result.error.message)
        }
      }
    }
  }
  fun closeCreate() = _state.update { it.copy(isCreating = false, error = null) }
  fun onSelectedOrder(value: String?) = _state.update { state ->
    val allowed = state.supportOrders.any { it.id == value }
    state.copy(selectedOrderId = if (allowed) value else null, error = null, message = null)
  }
  fun onSubject(value: String) = _state.update { it.copy(subject = value, error = null, message = null) }
  fun onTopic(value: String) = _state.update { it.copy(topic = value, error = null, message = null) }
  fun onPriority(value: String) = _state.update { it.copy(priority = value, error = null, message = null) }
  fun onDescription(value: String) = _state.update { it.copy(description = value, error = null, message = null) }
  fun onReply(value: String) = _state.update { it.copy(reply = value, error = null, message = null) }

  fun createTicket() {
    val current = _state.value
    if (current.saving) return
    val subject = current.subject.trim()
    val description = current.description.trim()
    if (subject.length !in 10..120 || description.length !in 10..3000) {
      _state.update { it.copy(error = "Subject must be 10–120 characters and the description 10–3,000 characters.") }
      return
    }
    _state.update { it.copy(saving = true, error = null, message = null) }
    viewModelScope.launch {
      when (val result = repository.createSupportTicket(subject, current.topic, current.priority, current.selectedOrderId, description)) {
        is AppResult.Success -> {
          _state.update {
            it.copy(
              saving = false,
              isCreating = false,
              subject = "",
              topic = "other",
              priority = "normal",
              description = "",
              message = "Ticket ${result.value} was submitted.",
            )
          }
          refresh()
        }
        is AppResult.Failure -> _state.update { it.copy(saving = false, error = result.error.message) }
      }
    }
  }

  fun sendReply() {
    val current = _state.value
    val ticketId = current.selectedTicketId ?: return
    val text = current.reply.trim()
    if (current.saving) return
    if (text.length !in 5..3000) {
      _state.update { it.copy(error = "A reply must contain 5–3,000 characters.") }
      return
    }
    _state.update { it.copy(saving = true, error = null, message = null) }
    viewModelScope.launch {
      when (val result = repository.replyToSupportTicket(ticketId, text)) {
        is AppResult.Success -> {
          _state.update { it.copy(saving = false, reply = "", message = "Reply sent.") }
          openTicket(ticketId)
        }
        is AppResult.Failure -> _state.update { it.copy(saving = false, error = result.error.message) }
      }
    }
  }
}
