package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.CatalogBrandDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogCategoryDto
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
 * Categories tab behaviour.
 *
 * Two things are pinned here. First, the directory is the server's taxonomy —
 * an unreachable server produces an honest failure, never an empty-looking shop.
 * Second, the on-device filter narrows what the server already sent: it cannot
 * surface a category that was never published, and it must not be mistaken for
 * a server search (so it must not fire a request).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CategoriesViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun taxonomy() = FakeCatalogApi().apply {
    categoriesResult = ApiEnvelope(
      CatalogCategoriesDto(
        categories = listOf(
          CatalogCategoryDto(id = "c1", name = "Grocery Staples", productCount = 12),
          CatalogCategoryDto(id = "c2", name = "Personal Care", productCount = null),
        ),
      ),
    )
    brandsResult = ApiEnvelope(
      CatalogBrandsDto(brands = listOf(CatalogBrandDto(id = "b1", name = "Grocery Gold"))),
    )
  }

  @Test
  fun `loads the published taxonomy on start`() = runTest(dispatcher) {
    val api = taxonomy()

    val viewModel = CategoriesViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.categories).hasSize(2)
    assertThat(state.brands).hasSize(1)
    assertThat(state.isEmpty).isFalse()
    // One directory request for categories; the brand list rides along with it.
    assertThat(api.categoryCalls).isEqualTo(1)
  }

  @Test
  fun `narrows only names the server sent, without asking the server again`() = runTest(dispatcher) {
    val api = taxonomy()
    val viewModel = CategoriesViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    viewModel.onFilterChange("gro")
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.visibleCategories.map { it.name }).containsExactly("Grocery Staples")
    assertThat(state.visibleBrands.map { it.name }).containsExactly("Grocery Gold")
    assertThat(state.noFilterMatch).isFalse()
    // The full list is still there: filtering is a view, not a reload.
    assertThat(state.categories).hasSize(2)
    assertThat(api.categoryCalls).isEqualTo(1)
  }

  @Test
  fun `says so when a filter matches nothing`() = runTest(dispatcher) {
    val api = taxonomy()
    val viewModel = CategoriesViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    viewModel.onFilterChange("zzz-no-such-thing")
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.visibleCategories).isEmpty()
    assertThat(state.visibleBrands).isEmpty()
    assertThat(state.noFilterMatch).isTrue()
    // "No match" must not be reported as "the shop has no categories".
    assertThat(state.isEmpty).isFalse()
  }

  @Test
  fun `reports a failed directory rather than an empty one`() = runTest(dispatcher) {
    val api = taxonomy().apply { nextCategoriesFailure = IOException("offline") }

    val viewModel = CategoriesViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.offline).isTrue()
    assertThat(state.retryable).isTrue()
    assertThat(state.errorMessage).isNotNull()
    assertThat(state.categories).isEmpty()
    assertThat(state.isEmpty).isFalse()
  }

  @Test
  fun `recognises a genuinely unpublished taxonomy as empty`() = runTest(dispatcher) {
    val api = FakeCatalogApi()

    val viewModel = CategoriesViewModel(repository = catalogRepository(api, dispatcher))
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.errorMessage).isNull()
    assertThat(state.isEmpty).isTrue()
  }

  @Test
  fun `collapses concurrent loads into one request`() = runTest(dispatcher) {
    val api = taxonomy()
    val viewModel = CategoriesViewModel(repository = catalogRepository(api, dispatcher))

    viewModel.load()
    viewModel.load()
    advanceUntilIdle()

    assertThat(api.categoryCalls).isEqualTo(1)
  }
}
