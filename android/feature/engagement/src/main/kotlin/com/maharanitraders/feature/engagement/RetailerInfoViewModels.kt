package com.maharanitraders.feature.engagement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.network.dto.MobileHelpDto
import com.maharanitraders.core.network.dto.MobileReportsDto
import com.maharanitraders.core.network.dto.MobileSchemeDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SchemesUiState(
  val schemes: List<MobileSchemeDto> = emptyList(),
  val loading: Boolean = true,
  val error: String? = null,
)

@HiltViewModel
class SchemesViewModel @Inject constructor(
  private val repository: RetailerUpgradeRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(SchemesUiState())
  val state: StateFlow<SchemesUiState> = _state.asStateFlow()
  init { load() }
  fun load() {
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadSchemes()) {
        is AppResult.Success -> _state.update { it.copy(schemes = result.value, loading = false) }
        is AppResult.Failure -> _state.update { it.copy(loading = false, error = result.error.message) }
      }
    }
  }
}

data class PurchaseReportsUiState(
  val reports: MobileReportsDto? = null,
  val loading: Boolean = true,
  val error: String? = null,
  val exportingType: String? = null,
  val exportCsv: String? = null,
  val exportError: String? = null,
)

@HiltViewModel
class PurchaseReportsViewModel @Inject constructor(
  private val repository: RetailerUpgradeRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(PurchaseReportsUiState())
  val state: StateFlow<PurchaseReportsUiState> = _state.asStateFlow()
  init { load() }
  fun load() {
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadPurchaseReports()) {
        is AppResult.Success -> _state.update { it.copy(reports = result.value, loading = false) }
        is AppResult.Failure -> _state.update { it.copy(loading = false, error = result.error.message) }
      }
    }
  }

  fun export(type: String, from: String?, to: String?) {
    if (_state.value.exportingType != null) return
    _state.update { it.copy(exportingType = type, exportCsv = null, exportError = null) }
    viewModelScope.launch {
      when (val result = repository.exportStatement(type, from, to)) {
        is AppResult.Success -> _state.update { it.copy(exportingType = null, exportCsv = result.value) }
        is AppResult.Failure -> _state.update { it.copy(exportingType = null, exportError = result.error.message) }
      }
    }
  }

  fun clearExport() = _state.update { it.copy(exportCsv = null, exportError = null) }
}

data class HelpUiState(
  val details: MobileHelpDto? = null,
  val loading: Boolean = true,
  val error: String? = null,
)

@HiltViewModel
class HelpViewModel @Inject constructor(
  private val repository: RetailerUpgradeRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(HelpUiState())
  val state: StateFlow<HelpUiState> = _state.asStateFlow()
  init { load() }
  fun load() {
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadHelpDetails()) {
        is AppResult.Success -> _state.update { it.copy(details = result.value, loading = false) }
        is AppResult.Failure -> _state.update { it.copy(loading = false, error = result.error.message) }
      }
    }
  }
}
