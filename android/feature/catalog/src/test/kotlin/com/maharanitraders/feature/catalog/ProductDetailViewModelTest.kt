package com.maharanitraders.feature.catalog

import androidx.lifecycle.SavedStateHandle
import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.ProductPackDetailDto
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

/**
 * Product detail behaviour.
 *
 * The detail screen shows money, so the invariants that matter are: the selected
 * pack can only ever be one the server priced, a 404 is a distinct state from a
 * transient failure, and no price is invented when the server could not quote one.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ProductDetailViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun handle(id: String?) =
    SavedStateHandle(if (id == null) emptyMap() else mapOf(ProductDetailViewModel.ARG_PRODUCT_ID to id))

  private fun detailDto(selected: String = "pack-1") = ProductDetailDto(
    id = "p1",
    name = "Basmati Rice",
    brandName = "Maharani",
    categoryName = "Rice",
    unit = "carton",
    hsnCode = "1006",
    gstPercent = 5.0,
    leadTimeDays = 2,
    isNewLaunch = true,
    images = listOf("https://cdn.maharanitraders.test/storage/v1/object/public/product-images/p1.jpg"),
    packs = listOf(
      ProductPackDetailDto(
        packId = "pack-1", packName = "500g", unitsPerCase = 4, moq = 4,
        unitPricePaise = 25000, lineTotalAtMoqPaise = 100000, gstPercent = 5.0,
        mrpPaise = 30000, availability = "in_stock", selected = selected == "pack-1",
        images = listOf("https://cdn.maharanitraders.test/storage/v1/object/public/product-images/pack1.jpg"),
      ),
      ProductPackDetailDto(
        packId = "pack-2", packName = "1kg", unitsPerCase = 8, moq = 8,
        unitPricePaise = null, lineTotalAtMoqPaise = null, gstPercent = 5.0,
        availability = "out_of_stock", selected = selected == "pack-2",
        message = "Please set a selling price for this pack before ordering.",
      ),
    ),
  )

  private fun notFound(): HttpException = HttpException(
    Response.error<Any>(
      404,
      """{"error":{"code":"not_found","message":"This product is no longer available."},"requestId":"r"}"""
        .toResponseBody("application/json".toMediaType()),
    ),
  )

  @Test
  fun `loads the product and selects the pack the route asked for`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { detailResult = ApiEnvelope(detailDto()) }

    val viewModel = ProductDetailViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
      savedStateHandle = handle("pack-1"),
    )
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.detail!!.name).isEqualTo("Basmati Rice")
    assertThat(api.productDetailRequests).containsExactly("pack-1")
    assertThat(state.selectedPack?.packId).isEqualTo("pack-1")
    assertThat(state.selectedPack?.unitPricePaise).isEqualTo(25000L)
    // The pack gallery wins over the product gallery.
    assertThat(state.gallery.single()).contains("pack1.jpg")
  }

  @Test
  fun `only switches to a pack the server returned`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { detailResult = ApiEnvelope(detailDto()) }
    val viewModel = ProductDetailViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
      savedStateHandle = handle("p1"),
    )
    advanceUntilIdle()

    viewModel.selectPack("pack-2")
    assertThat(viewModel.state.value.selectedPack?.packId).isEqualTo("pack-2")

    // An id the server never priced is ignored: the screen cannot show a price
    // for a pack that was never quoted.
    viewModel.selectPack("pack-invented")
    assertThat(viewModel.state.value.selectedPack?.packId).isEqualTo("pack-2")

    // An unpriced pack reports null, not zero, and keeps the engine's own reason.
    assertThat(viewModel.state.value.selectedPack?.unitPricePaise).isNull()
    assertThat(viewModel.state.value.selectedPack?.availability).isEqualTo(PackAvailability.OUT_OF_STOCK)
    assertThat(viewModel.state.value.selectedPack?.message).contains("selling price")
  }

  @Test
  fun `treats a 404 as gone rather than retryable`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { nextDetailFailure = notFound() }

    val viewModel = ProductDetailViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
      savedStateHandle = handle("missing"),
    )
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.notFound).isTrue()
    assertThat(state.retryable).isFalse()
    assertThat(state.detail).isNull()
  }

  @Test
  fun `treats a transport failure as retryable and offline`() = runTest(dispatcher) {
    val api = FakeCatalogApi().apply { nextDetailFailure = IOException("no network") }

    val viewModel = ProductDetailViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
      savedStateHandle = handle("p1"),
    )
    advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.notFound).isFalse()
    assertThat(state.offline).isTrue()
    assertThat(state.retryable).isTrue()
  }

  @Test
  fun `reports an unusable route argument instead of calling the server`() = runTest(dispatcher) {
    val api = FakeCatalogApi()

    val viewModel = ProductDetailViewModel(
      repository = catalogRepository(api, dispatcher),
      favorites = favoritesStore(api, dispatcher),
      savedStateHandle = handle(null),
    )
    advanceUntilIdle()

    assertThat(viewModel.state.value.notFound).isTrue()
    assertThat(viewModel.state.value.retryable).isFalse()
    assertThat(api.productDetailRequests).isEmpty()
  }
}
