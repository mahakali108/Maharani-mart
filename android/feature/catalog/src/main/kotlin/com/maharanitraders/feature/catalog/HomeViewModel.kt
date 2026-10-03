package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.RetailerHome
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Everything the retailer home renders, as one explicit state.
 *
 * There is no separate `isLoading` flag to forget to clear, and no way to be
 * "loading" and "errored" at the same time. A `home` payload and an
 * `errorMessage` can coexist only while a REFRESH is in flight, which is what
 * keeps previously loaded content on screen behind a spinner instead of
 * flashing an empty page.
 */
data class HomeUiState(
  val loading: Boolean = true,
  val refreshing: Boolean = false,
  val home: RetailerHome? = null,
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
) {
  /** Nothing at all to show: no banners, no categories and no products. */
  val isEmpty: Boolean
    get() {
      val payload = home ?: return false
      return payload.banners.isEmpty() && payload.categories.isEmpty() && payload.products.isEmpty()
    }

  val hasContent: Boolean get() = home != null
}

/**
 * The retailer home.
 *
 * Every value it exposes came from `GET /api/mobile/v1/home`: admin-published
 * banners, the real category strip and the first batch of the real catalogue.
 * This ViewModel holds no fallback content of its own — when the request fails
 * the screen says so and offers a retry, because a home screen full of plausible
 * looking products that the warehouse does not have is worse than an honest
 * error.
 *
 * Cart, coins and orders are deliberately absent: they belong to later phases.
 */
@HiltViewModel
class HomeViewModel @Inject constructor(
  private val repository: CatalogRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(HomeUiState())
  val state: StateFlow<HomeUiState> = _state.asStateFlow()

  private var request: Job? = null

  init {
    load()
  }

  /** Load or reload the home payload. Concurrent calls collapse into one. */
  fun load() {
    if (request?.isActive == true) return

    val refresh = _state.value.home != null
    _state.update {
      if (refresh) it.copy(refreshing = true, errorMessage = null, offline = false)
      else it.copy(loading = true, errorMessage = null, offline = false)
    }

    request = viewModelScope.launch {
      when (val result = repository.loadHome()) {
        is AppResult.Success -> _state.update {
          it.copy(loading = false, refreshing = false, home = result.value, errorMessage = null, offline = false)
        }

        is AppResult.Failure -> _state.update { state ->
          state.copy(
            loading = false,
            refreshing = false,
            errorMessage = result.error.message,
            offline = result.error.isOffline,
            retryable = result.error.retryable,
          )
        }
      }
    }
  }
}
