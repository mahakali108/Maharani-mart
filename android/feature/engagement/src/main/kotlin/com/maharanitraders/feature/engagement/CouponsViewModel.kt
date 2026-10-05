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

data class CouponsUiState(
  val loading: Boolean = true,
  val coupons: List<CouponItem> = emptyList(),
  val errorMessage: String? = null,
  val offline: Boolean = false,
)

@HiltViewModel
class CouponsViewModel @Inject constructor(
  private val repository: EngagementRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(CouponsUiState())
  val state: StateFlow<CouponsUiState> = _state.asStateFlow()

  init {
    load()
  }

  fun load() {
    _state.update { it.copy(loading = true, errorMessage = null) }
    viewModelScope.launch {
      when (val result = repository.loadCoupons()) {
        is AppResult.Success -> _state.update {
          it.copy(
            loading = false,
            coupons = result.value.coupons,
            errorMessage = null,
            offline = false,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            loading = false,
            errorMessage = result.error.message,
            offline = result.error is AppError.Network,
          )
        }
      }
    }
  }
}