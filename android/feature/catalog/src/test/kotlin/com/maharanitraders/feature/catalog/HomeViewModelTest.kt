package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.CatalogCategoryDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.PromoBannerDto
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

  private fun home(banners: Int = 1, categories: Int = 1, products: Int = 1) = ApiEnvelope(
    RetailerHomeDto(
      banners = (0 until banners).map {
        PromoBannerDto(id = "b$it", title = "Banner $it", linkUrl = "/retailer/catalog")
      },
      categories = (0 until categories).map { CatalogCategoryDto(id = "c$it", name = "Cat $it") },
      products = (0 until products).map { CatalogProductDto(id = "p$it", name = "Product $it") },
      nextCursor = null,
    ),
  )

  @Test
  fun `optional newest failure is visible without blanking home`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply {
      homeResult = home()
      nextProductFailure = IOException("newest unavailable")
    }
    val viewModel = HomeViewModel(catalogRepository(api, dispatcher), favoritesStore(api, dispatcher))
    advanceUntilIdle()
    assertThat(viewModel.state.value.home).isNotNull()
    assertThat(viewModel.state.value.recentError).isNotNull()
    assertThat(viewModel.state.value.errorMessage).isNull()
    api.nextProductFailure = null
    viewModel.load()
    advanceUntilIdle()
    assertThat(viewModel.state.value.recentError).isNull()
  }

  @Test
  fun `category mapping preserves published parent identity`() {
    val category = CatalogMapper.category(CatalogCategoryDto(id = "child", name = "Child", parentName = "Parent"))
    assertThat(category.parentName).isEqualTo("Parent")
    assertThat(category.productCount).isNull()
  }

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
}
