package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import com.maharanitraders.core.model.RetailerHome
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
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
  /** The "Recently added" rail: the catalogue's real newest-first batch. */
  val recent: List<CatalogProduct> = emptyList(),
  val recentLoading: Boolean = true,
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
 * Every value it exposes came from the server: `GET /api/mobile/v1/home`
 * (admin-published banners, the real category strip, brands and the first
 * batch of the real catalogue) plus one `GET /api/mobile/v1/catalog/products?
 * sort=newest` batch for the "Recently added" rail — the same endpoint and the
 * same server ordering the web catalogue uses, so the rail is a real view of
 * the catalogue, never a separately curated (and therefore separately stale)
 * list. The newest-first batch is OPTIONAL: if it fails, the rail is simply
 * not shown and the home screen still renders, because one extra rail must not
 * be able to take the shop down.
 *
 * This ViewModel holds no fallback content of its own — when the home request
 * fails the screen says so and offers a retry, because a home screen full of
 * plausible looking products that the warehouse does not have is worse than an
 * honest error. Cart and order history are separate Phase E destinations, not
 * part of the home response; a Coins wallet summary remains later work.
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
      if (refresh) {
        it.copy(refreshing = true, errorMessage = null, offline = false)
      } else {
        it.copy(loading = true, errorMessage = null, offline = false)
      }
    }

    request = viewModelScope.launch {
      val (homeResult, recentResult) = coroutineScope {
        val home = async { repository.loadHome() }
        val recent = async { repository.loadProducts(RECENT_QUERY, cursor = null) }
        home.await() to recent.await()
      }

      when (homeResult) {
        is AppResult.Success -> {
          val home = homeResult.value
          // The rail must not repeat what the discovery grid already shows: a
          // shopper seeing the same card twice on one screen reads as a bug.
          val seen = home.products.mapTo(HashSet()) { it.id }
          val recent = (recentResult as? AppResult.Success)?.value?.products
            ?.filterNot { it.id in seen }
            .orEmpty()
          _state.update {
            it.copy(
              loading = false,
              refreshing = false,
              home = home,
              recent = recent,
              recentLoading = false,
              errorMessage = null,
              offline = false,
            )
          }
        }

        is AppResult.Failure -> _state.update { state ->
          state.copy(
            loading = false,
            refreshing = false,
            recentLoading = false,
            errorMessage = homeResult.error.message,
            offline = homeResult.error.isOffline,
            retryable = homeResult.error.retryable,
          )
        }
      }
    }
  }

  companion object {
    /** The rail's own query: the server's newest-first ordering, no filters. */
    val RECENT_QUERY: CatalogQuery = CatalogQuery(sort = CatalogSort.NEWEST)
  }
}
