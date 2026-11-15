package com.maharanitraders.feature.engagement

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.core.network.dto.ManagedPageDto
import com.maharanitraders.core.network.dto.ManagedPageSectionDto
import com.maharanitraders.core.network.dto.ManagedPageSummaryDto
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The policy index: every published page the server offers.
 *
 * States are explicit rather than "empty means loading":
 *  - [loading] the first read is in flight;
 *  - [pages] a non-empty list (rendered);
 *  - [empty] the read succeeded and nothing is published — a real answer that
 *    must not look like a failure and must not offer a pointless retry loop;
 *  - [error] a failure, with [retryable] taken from the server's own code
 *    (offline and 5xx retry; a permission answer does not).
 */
data class LegalCentreUiState(
  val pages: List<ManagedPageSummaryDto> = emptyList(),
  val loading: Boolean = true,
  val error: String? = null,
  val retryable: Boolean = true,
) {
  val isEmpty: Boolean get() = !loading && error == null && pages.isEmpty()
}

@HiltViewModel
class LegalCentreViewModel @Inject constructor(
  private val repository: ManagedContentRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(LegalCentreUiState())
  val state: StateFlow<LegalCentreUiState> = _state.asStateFlow()

  init {
    load()
  }

  fun load() {
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      when (val result = repository.loadPages()) {
        is AppResult.Success ->
          _state.update {
            it.copy(
              pages = ManagedContentPresentation.index(result.value),
              loading = false,
              error = null,
              retryable = true,
            )
          }

        is AppResult.Failure ->
          _state.update {
            it.copy(
              loading = false,
              error = result.error.message,
              retryable = result.error.retryable,
            )
          }
      }
    }
  }
}

/**
 * One page. The slug comes from the navigation argument, so the screen cannot
 * show a different page than the link the shopper tapped.
 *
 * [unavailable] is the honest state for "published nowhere yet": the server
 * answered 404 with a reason, so the screen shows the website's own sentence and
 * keeps the policy index and back navigation working. It is deliberately NOT an
 * error banner with a retry: retrying cannot publish the page.
 */
data class ManagedPageUiState(
  val slug: String = "",
  val page: ManagedPageDto? = null,
  val loading: Boolean = true,
  val error: String? = null,
  val retryable: Boolean = true,
  val unavailable: Boolean = false,
) {
  val sections: List<ManagedPageSectionDto>
    get() = page?.let(ManagedContentPresentation::renderableSections).orEmpty()

  /** A published page with no renderable section is still shown — intro only. */
  val isEmpty: Boolean get() = !loading && error == null && !unavailable && page == null
}

@HiltViewModel
class ManagedPageViewModel @Inject constructor(
  private val repository: ManagedContentRepository,
  savedStateHandle: SavedStateHandle,
) : ViewModel() {

  private val slug: String = savedStateHandle.get<String>(ARG_SLUG).orEmpty()

  private val _state = MutableStateFlow(ManagedPageUiState(slug = slug))
  val state: StateFlow<ManagedPageUiState> = _state.asStateFlow()

  init {
    load()
  }

  fun load() {
    if (slug.isBlank()) {
      _state.update { it.copy(loading = false, unavailable = true) }
      return
    }
    _state.update { it.copy(loading = true, error = null, unavailable = false) }
    viewModelScope.launch {
      when (val result = repository.loadPage(slug)) {
        is AppResult.Success ->
          _state.update {
            it.copy(page = result.value, loading = false, error = null, unavailable = false)
          }

        is AppResult.Failure -> {
          // `AppResult.error` is declared in another module, so it must be bound
          // to a local before it can be smart-cast (SMARTCAST_IMPOSSIBLE).
          val failure = result.error
          // "Not published" is the server's 404; a draft is never distinguishable
          // from a page that does not exist, which is exactly the intent.
          val unavailable = failure is AppError.Api && failure.code == ApiErrorCode.NOT_FOUND
          _state.update {
            it.copy(
              loading = false,
              unavailable = unavailable,
              // The server's message is the website's own sentence for an
              // unpublished page; an error banner is only for real failures.
              error = if (unavailable) null else failure.message,
              retryable = failure.retryable,
            )
          }
        }
      }
    }
  }

  companion object {
    const val ARG_SLUG = "slug"
  }
}
