package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.TimeSource
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.CatalogCategoryDto
import com.maharanitraders.core.network.dto.CatalogPackDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.MobileSchemeDto
import com.maharanitraders.core.network.dto.PromoBannerDto
import com.maharanitraders.core.network.dto.PageDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * Retailer home behaviour.
 *
 * The home screen is the first thing a retailer sees, so its states matter more
 * than its content: a shop that looks stocked when the server is unreachable is
 * worse than an honest error. These tests pin that down.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun home(
    banners: Int = 1,
    categories: Int = 1,
    products: Int = 1,
    schemes: List<MobileSchemeDto> = emptyList(),
    schemesUnavailable: Boolean = false,
  ) = ApiEnvelope(
    RetailerHomeDto(
      banners = (0 until banners).map {
        PromoBannerDto(id = "b$it", title = "Banner $it", linkUrl = "/retailer/catalog")
      },
      categories = (0 until categories).map { CatalogCategoryDto(id = "c$it", name = "Cat $it") },
      products = (0 until products).map { CatalogProductDto(id = "p$it", name = "Product $it") },
      nextCursor = null,
      schemes = schemes,
      schemesUnavailable = schemesUnavailable,
    ),
  )

  /** One batch of the catalogue, for the newest-first and deals rails. */
  private fun batch(vararg ids: String) = ApiEnvelope(
    data = ids.map { id ->
      CatalogProductDto(
        id = id,
        name = "Product $id",
        pack = CatalogPackDto(
          packId = "pack-$id",
          packName = "500g",
          moq = 4,
          unitPricePaise = 100,
        ),
      )
    },
    page = PageDto(nextCursor = null, hasMore = false, limit = 24),
  )

  private fun scheme(
    id: String = "s1",
    name: String = "Diwali wholesale week",
    description: String? = "Extra slab rates on staples",
    isFestival: Boolean = false,
    endsAt: String = "2026-11-05T00:00:00.000Z",
  ) = MobileSchemeDto(
    id = id,
    name = name,
    description = description,
    isFestival = isFestival,
    startsAt = "2026-10-01T00:00:00.000Z",
    endsAt = endsAt,
  )

  /** 2026-10-08T00:00:00Z, so a deadline assertion cannot race midnight. */
  private val fixedNowSeconds = 1_791_417_600L

  private class FixedTimeSource(private val seconds: Long) : TimeSource {
    override fun nowEpochSeconds(): Long = seconds
  }

  private fun viewModel(
    api: FakeCatalogApi,
    timeSource: TimeSource = FixedTimeSource(fixedNowSeconds),
  ) = HomeViewModel(
    repository = catalogRepository(api, dispatcher),
    favorites = favoritesStore(api, dispatcher),
    timeSource = timeSource,
  )

  @Test
  fun `loads the payload on start`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { homeResult = home() }

    val viewModel = HomeViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
    )
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.hasContent).isTrue()
    assertThat(state.home!!.banners).hasSize(1)
    assertThat(state.home!!.categories).hasSize(1)
    assertThat(state.home!!.products).hasSize(1)
    assertThat(api.homeCalls).isEqualTo(1)
  }

  @Test
  fun `reports an offline state rather than an empty shop`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { nextHomeFailure = IOException("offline") }

    val viewModel = HomeViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
    )
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.offline).isTrue()
    assertThat(state.retryable).isTrue()
    assertThat(state.errorMessage).isNotNull()
    // No fabricated content behind the error.
    assertThat(state.home).isNull()
    assertThat(state.isEmpty).isFalse()
  }

  @Test
  fun `keeps loaded content when a refresh fails`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { homeResult = home() }
    val viewModel = HomeViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
    )
    advanceUntilIdle()

    api.nextHomeFailure = IOException("offline")
    viewModel.load()
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.home).isNotNull()
    assertThat(state.errorMessage).isNotNull()
    assertThat(state.offline).isTrue()
    assertThat(state.refreshing).isFalse()
  }

  @Test
  fun `collapses concurrent loads into one request`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { homeResult = home() }
    val viewModel = HomeViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
    )

    viewModel.load()
    viewModel.load()
    advanceUntilIdle()

    assertThat(api.homeCalls).isEqualTo(1)
  }

  @Test
  fun `recognises a genuinely empty shop as empty`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { homeResult = home(banners = 0, categories = 0, products = 0) }

    val viewModel = HomeViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
    )
    advanceUntilIdle()

    assertThat(viewModel.state.value.isEmpty).isTrue()
    assertThat(viewModel.state.value.hasContent).isTrue()
  }

  // ---------------------------------------------------------------------------
  // The admin's own merchandising: schemes, the ticker and the deals rail
  // ---------------------------------------------------------------------------

  @Test
  fun `the offers rail is built from the schemes an admin published`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      homeResult = home(
        schemes = listOf(
          scheme(id = "s1", endsAt = "2026-11-05T00:00:00.000Z"),
          scheme(
            id = "s2",
            name = "Monsoon staples",
            description = null,
            isFestival = true,
            endsAt = "2026-10-09T00:00:00.000Z",
          ),
        ),
      )
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.offersUnavailable).isFalse()
    assertThat(state.promotions.map { it.id }).containsExactly("s1", "s2").inOrder()
    assertThat(state.promotions[0].deadline).isEqualTo("Ends in 28 days")
    assertThat(state.promotions[1].deadline).isEqualTo("Ends tomorrow")
    assertThat(state.promotions[1].isFestival).isTrue()
    assertThat(state.promotions[1].description).isNull()
    // The raw rows stay on the state too, so the screen and the offers screen are
    // reading one answer rather than two interpretations of it.
    assertThat(state.offers.map { it.id }).containsExactly("s1", "s2").inOrder()
  }

  @Test
  fun `deadlines are counted against the injected clock, not the device's`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      homeResult = home(schemes = listOf(scheme(endsAt = "2026-11-05T00:00:00.000Z")))
    }

    // One day later, the same row must say one day less. A deadline computed from
    // a clock the test cannot see is a deadline no test can pin.
    val viewModel = viewModel(api, FixedTimeSource(fixedNowSeconds + 86_400L))
    advanceUntilIdle()

    assertThat(viewModel.state.value.promotions[0].deadline).isEqualTo("Ends in 27 days")
  }

  @Test
  fun `no published scheme means no promotions and no claim that there are none`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { homeResult = home(schemes = emptyList()) }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.promotions).isEmpty()
    // Empty AND available: the shop honestly has nothing running, so the screen
    // draws no rail and no "no offers" message either.
    assertThat(state.offersUnavailable).isFalse()
  }

  @Test
  fun `a failed offer read is flagged rather than flattened into an empty list`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      homeResult = home(schemes = emptyList(), schemesUnavailable = true)
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.promotions).isEmpty()
    // This is the whole point of keeping the two apart: with this true the screen
    // must NOT announce a shop with no offers, because it does not know that.
    assertThat(state.offersUnavailable).isTrue()
    // And the shop itself is still perfectly usable.
    assertThat(state.home).isNotNull()
    assertThat(state.errorMessage).isNull()
  }

  @Test
  fun `the deals rail asks the server for offers and nothing else`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      homeResult = home()
      productPages.addLast(batch("n1", "n2"))
      productPages.addLast(batch("d1", "d2"))
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    // The home costs exactly two catalogue reads beyond the home payload: the
    // newest-first rail and the deals rail. One more per section is how a home
    // screen eats the server's read budget before the shopper has scrolled.
    assertThat(api.productRequests).hasSize(2)
    val newest = api.productRequests.first { it.sort == "newest" }
    assertThat(newest.offersOnly).isNull()
    val deals = api.productRequests.first { it.offersOnly == "1" }
    // `offers=1` is the SERVER's own filter: a deal here is a discount the pricing
    // engine really applied, not a card the home screen decided to label.
    assertThat(deals.sort).isNull()
    assertThat(deals.cursor).isNull()
    assertThat(viewModel.state.value.deals.map { it.id }).containsExactly("d1", "d2").inOrder()
    assertThat(viewModel.state.value.recent.map { it.id }).containsExactly("n1", "n2").inOrder()
    assertThat(viewModel.state.value.dealsLoading).isFalse()
  }

  @Test
  fun `a deal already on the grid or the newest rail is not shown a third time`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      homeResult = home(products = 2) // p0, p1 on the discovery grid
      productPages.addLast(batch("p1", "n1")) // newest rail repeats p1
      productPages.addLast(batch("p0", "n1", "d1")) // deals repeats both
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.recent.map { it.id }).containsExactly("n1")
    // The same card twice on one screen reads as a bug, however true it is.
    assertThat(state.deals.map { it.id }).containsExactly("d1")
  }

  @Test
  fun `a failed rail read leaves the shop on screen and says nothing false`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      homeResult = home()
      nextProductFailure = IOException("rails down")
    }

    val viewModel = viewModel(api)
    advanceUntilIdle()

    val state = viewModel.state.value
    // The home payload is the shop; the rails are optional. One extra rail must
    // not be able to take the shop down, and its absence must not be reported as
    // a failure of the page.
    assertThat(state.home).isNotNull()
    assertThat(state.errorMessage).isNull()
    assertThat(state.loading).isFalse()
    assertThat(state.recent).isEmpty()
    assertThat(state.deals).isEmpty()
    assertThat(state.recentLoading).isFalse()
    assertThat(state.dealsLoading).isFalse()
  }
}
