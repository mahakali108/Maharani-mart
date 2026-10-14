package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.SystemTimeSource
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import com.maharanitraders.core.model.HomeScheme
import com.maharanitraders.core.model.RetailerHome
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
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
  /** Set when the optional newest-first rail read failed while home succeeded. */
  val recentError: String? = null,
  /**
   * The "Deals" rail: the catalogue's own `offers=1` batch — rows the SERVER
   * marked as carrying an offer or a real MRP discount, priced for this
   * retailer. It is an ordinary catalogue read, so a deal is a deal checkout
   * would honour, not a card the home screen chose to decorate.
   */
  val deals: List<CatalogProduct> = emptyList(),
  val dealsLoading: Boolean = true,
  /**
   * The admin's live offers, soonest-ending first, exactly as `GET /home`
   * returned them. Empty means no offer is running.
   */
  val offers: List<HomeScheme> = emptyList(),
  /**
   * True when the offer read FAILED rather than returning nothing. The offers
   * rail is not drawn in either case, but this is what stops the screen from
   * claiming "no offers right now" during an outage.
   */
  val offersUnavailable: Boolean = false,
  /**
   * The live offers, ready to draw, derived from [offers] by [HomePromo] with one
   * clock read. The ticker strip at the top of home and the "Today's offers" rail
   * are both projections of this list, so they can never disagree about a
   * deadline. Empty draws neither.
   */
  val promotions: List<HomePromo.OfferCard> = emptyList(),
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
) {
  /** Nothing at all to show: no banners, no categories and no products. */
  val isEmpty: Boolean
    get() {
      val payload = home ?: return false
      return payload.banners.isEmpty() && payload.categories.isEmpty() && payload.brands.isEmpty() && payload.products.isEmpty()
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
 * list. The newest-first batch is OPTIONAL: if it fails, the rail reports a retryable error and the home screen still renders, because one extra rail must not
 * be able to take the shop down.
 *
 * This ViewModel holds no fallback content of its own — when the home request
 * fails the screen says so and offers a retry, because a home screen full of
 * plausible looking products that the warehouse does not have is worse than an
 * honest error. Cart and order history are separate Phase E destinations, not
 * part of the home response; the Coins dashboard is supplied separately by the shell.
 */
@HiltViewModel
class HomeViewModel @Inject constructor(
  private val repository: CatalogRepository,
  /**
   * The ONE source of favourite state. The home rails and grid read it (and
   * toggle through it) exactly like the catalogue and product detail, so a heart
   * tapped here is already correct on the product page and in the saved list.
   */
  private val favorites: FavoritesStore,
  /**
   * The clock the offer deadlines are counted against. Injectable so a test can
   * pin "today" instead of racing midnight; defaults to the system clock so the
   * shell needs no extra wiring.
   */
  private val timeSource: TimeSource = SystemTimeSource(),
) : ViewModel() {

  private val _state = MutableStateFlow(HomeUiState())
  val state: StateFlow<HomeUiState> = _state.asStateFlow()

  /** Observed directly by the screen; the home keeps no favourite copy. */
  val favoriteState: StateFlow<FavoritesSnapshot> = favorites.state

  private var request: Job? = null

  init {
    viewModelScope.launch { favorites.ensureLoaded() }
    load()
  }

  /** Toggle one product from a home card. Server-authoritative, like everywhere. */
  fun toggleFavorite(productId: String) {
    viewModelScope.launch { favorites.toggle(productId) }
  }

  fun consumeFavoriteMessage() {
    favorites.clearError()
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
      // Three reads in parallel, all children of this launch: home (banners,
      // taxonomy, the discovery batch AND the admin's live offers), the
      // newest-first rail and the offers-filtered deals rail. One round trip
      // each, and a slow rail cannot delay the shop underneath it.
      val homeDeferred = async { repository.loadHome() }
      val recentDeferred = async { repository.loadProducts(RECENT_QUERY, cursor = null) }
      val dealsDeferred = async { repository.loadProducts(DEALS_QUERY, cursor = null) }
      val homeResult = homeDeferred.await()
      val recentResult = recentDeferred.await()
      val dealsResult = dealsDeferred.await()

      when (homeResult) {
        is AppResult.Success -> {
          val home = homeResult.value
          // The rails must not repeat what the discovery grid already shows: a
          // shopper seeing the same card twice on one screen reads as a bug.
          val seen = home.products.mapTo(HashSet()) { it.id }
          val recent = (recentResult as? AppResult.Success)?.value?.products
            ?.filterNot { it.id in seen }
            .orEmpty()
          // A deal already on the discovery grid or the newest rail is not shown
          // a third time either.
          val recentSeen = recent.mapTo(HashSet()) { row -> row.id }
          val deals = (dealsResult as? AppResult.Success)?.value?.products
            ?.filterNot { it.id in seen || it.id in recentSeen }
            .orEmpty()
          val nowMillis = timeSource.nowEpochSeconds() * 1_000L
          _state.update {
            it.copy(
              loading = false,
              refreshing = false,
              home = home,
              recent = recent,
              recentLoading = false,
              recentError = (recentResult as? AppResult.Failure)?.error?.message,
              deals = deals,
              dealsLoading = false,
              offers = home.schemes,
              offersUnavailable = home.schemesUnavailable,
              promotions = HomePromo.cards(home.schemes, nowMillis),
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
            dealsLoading = false,
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

    /**
     * The deals rail's query: the server's own offer filter.
     *
     * `offers=1` keeps rows the pricing engine marked `hasOffer` OR whose printed
     * MRP is above the resolved rate (`lib/retailer/catalog-batches.ts`), so a
     * "deal" here is a discount the shopper will actually get — never a card the
     * app decided to label.
     */
    val DEALS_QUERY: CatalogQuery = CatalogQuery(offersOnly = true)
  }
}
