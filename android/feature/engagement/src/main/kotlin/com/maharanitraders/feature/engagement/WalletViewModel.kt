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

data class WalletUiState(
  val summaryLoading: Boolean = true,
  val summary: WalletSummary? = null,
  val ledgerLoading: Boolean = true,
  val entries: List<WalletLedgerEntry> = emptyList(),
  val ledgerNextCursor: String? = null,
  val ledgerHasMore: Boolean = false,
  val ledgerTotal: Int = 0,
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val loadingMore: Boolean = false,
)

@HiltViewModel
class WalletViewModel @Inject constructor(
  private val repository: EngagementRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(WalletUiState())
  val state: StateFlow<WalletUiState> = _state.asStateFlow()

  init {
    load()
  }

  fun load() {
    _state.update { it.copy(summaryLoading = true, ledgerLoading = true, errorMessage = null) }
    viewModelScope.launch {
      // Load summary
      when (val result = repository.loadWalletSummary()) {
        is AppResult.Success -> _state.update {
          it.copy(summaryLoading = false, summary = result.value, errorMessage = null, offline = false)
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            summaryLoading = false,
            errorMessage = result.error.message,
            offline = result.error is AppError.Network,
          )
        }
      }
      // Load ledger
      when (val result = repository.loadWalletLedger(cursor = null)) {
        is AppResult.Success -> _state.update {
          it.copy(
            ledgerLoading = false,
            entries = result.value.entries,
            ledgerNextCursor = result.value.nextCursor,
            ledgerHasMore = result.value.hasMore,
            ledgerTotal = result.value.total,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            ledgerLoading = false,
            errorMessage = it.errorMessage ?: result.error.message,
          )
        }
      }
    }
  }

  fun loadMore() {
    val cursor = _state.value.ledgerNextCursor ?: return
    if (_state.value.loadingMore) return
    _state.update { it.copy(loadingMore = true) }
    viewModelScope.launch {
      when (val result = repository.loadWalletLedger(cursor = cursor)) {
        is AppResult.Success -> _state.update { state ->
          state.copy(
            loadingMore = false,
            entries = state.entries + result.value.entries,
            ledgerNextCursor = result.value.nextCursor,
            ledgerHasMore = result.value.hasMore,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(loadingMore = false, errorMessage = result.error.message)
        }
      }
    }
  }
}