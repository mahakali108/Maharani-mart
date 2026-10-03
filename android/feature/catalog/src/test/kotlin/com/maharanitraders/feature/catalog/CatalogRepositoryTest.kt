package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.CatalogPackDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.ListMetaDto
import com.maharanitraders.core.network.dto.PageDto
import com.maharanitraders.core.network.dto.PriceTierDto
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
 * Catalogue repository behaviour, as a plain JVM test.
 *
 * What is asserted here is the part of Phase D that must not regress quietly:
 *   - filters reach the wire as parameters, and defaults are OMITTED rather
 *     than sent as empty strings;
 *   - pagination comes from the server's `page` block, never from the length of
 *     a batch;
 *   - money stays integer paise end to end;
 *   - an availability string the app has never seen becomes UNKNOWN, so a newer
 *     server can never make an old app display "in stock" by accident;
 *   - a transport failure becomes a typed, retryable, offline-shaped error.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CatalogRepositoryTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun envelope(
    products: List<CatalogProductDto>,
    nextCursor: String? = null,
    hasMore: Boolean = false,
    resultCount: Int? = null,
    resultCapped: Boolean = false,
  ) = ApiEnvelope(
    data = products,
    page = PageDto(nextCursor = nextCursor, hasMore = hasMore, limit = 24),
    meta = ListMetaDto(resultCount = resultCount, resultCapped = resultCapped),
  )

  private fun packDto(over: CatalogPackDto.() -> CatalogPackDto = { this }) = CatalogPackDto(
    packId = "pack-1",
    packName = "500g",
    unitsPerCase = 4,
    moq = 4,
    unitPricePaise = 25000,
    mrpPaise = 30000,
    derivedCasePricePaise = 100000,
    tiers = emptyList(),
    availability = "in_stock",
  ).over()

  private fun productDto(id: String = "p1", pack: CatalogPackDto? = packDto()) = CatalogProductDto(
    id = id,
    name = "Basmati Rice 500g",
    brandName = "Maharani",
    imageUrl = "https://cdn.maharanitraders.test/storage/v1/object/public/product-images/p1.jpg",
    isNewLaunch = true,
    categoryId = "c1",
    brandId = "b1",
    hasOffer = false,
    isFavorite = false,
    pack = pack,
  )

  @Test
  fun `omits parameters that mean nothing instead of sending empty strings`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(envelope(emptyList()))

    catalogRepository(api, dispatcher).loadProducts(CatalogQuery.DEFAULT, cursor = null)
    advanceUntilIdle()

    assertThat(api.productRequests).hasSize(1)
    val request = api.productRequests.first()
    assertThat(request.search).isNull()
    assertThat(request.categoryId).isNull()
    assertThat(request.brandId).isNull()
    assertThat(request.sort).isNull()
    assertThat(request.inStock).isNull()
    assertThat(request.cursor).isNull()
  }

  @Test
  fun `sends the filters the shopper actually set`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(envelope(emptyList()))

    catalogRepository(api, dispatcher).loadProducts(
      CatalogQuery(
        search = "  rice  ",
        categoryId = "cat-1",
        sort = CatalogSort.PRICE_LOW,
        inStockOnly = true,
      ),
      cursor = "opaque-cursor",
    )
    advanceUntilIdle()

    assertThat(api.productRequests.single()).isEqualTo(
      FakeCatalogApi.ProductRequest(
        search = "rice",
        categoryId = "cat-1",
        brandId = null,
        sort = "price-low",
        inStock = "1",
        cursor = "opaque-cursor",
      ),
    )
  }

  @Test
  fun `treats a blank cursor as the first batch`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(envelope(emptyList()))

    catalogRepository(api, dispatcher).loadProducts(CatalogQuery.DEFAULT, cursor = "   ")
    advanceUntilIdle()

    assertThat(api.productRequests.single().cursor).isNull()
  }

  @Test
  fun `reads pagination from the server rather than from the batch length`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    // A FULL batch with no next cursor: inferring `hasMore` from the size would
    // keep the list scrolling forever on an exact multiple of the page size.
    val full = List(24) { productDto(id = "p$it") }
    api.productPages.addLast(envelope(full, nextCursor = null, hasMore = false, resultCount = 24))

    val result = catalogRepository(api, dispatcher).loadProducts(CatalogQuery.DEFAULT, cursor = null)
    advanceUntilIdle()

    val page = (result as AppResult.Success).value
    assertThat(page.products).hasSize(24)
    assertThat(page.hasMore).isFalse()
    assertThat(page.nextCursor).isNull()
    assertThat(page.resultCount).isEqualTo(24)
  }

  @Test
  fun `surfaces a capped working set so the ui can disclose it`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(
      envelope(listOf(productDto()), nextCursor = "c2", hasMore = true, resultCount = 240, resultCapped = true),
    )

    val page = (catalogRepository(api, dispatcher).loadProducts(CatalogQuery.DEFAULT, null) as AppResult.Success).value
    advanceUntilIdle()

    assertThat(page.resultCapped).isTrue()
    assertThat(page.resultCount).isEqualTo(240)
    assertThat(page.nextCursor).isEqualTo("c2")
  }

  @Test
  fun `keeps money as integer paise and maps every pack field`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(
      envelope(
        listOf(
          productDto(
            pack = packDto {
              copy(
                tiers = listOf(
                  PriceTierDto(minQuantity = 8, maxQuantity = 16, pricePerPiecePaise = 24000),
                  PriceTierDto(minQuantity = 16, maxQuantity = null, pricePerPiecePaise = 23500),
                ),
              )
            },
          ),
        ),
      ),
    )

    val page = (catalogRepository(api, dispatcher).loadProducts(CatalogQuery.DEFAULT, null) as AppResult.Success).value
    advanceUntilIdle()

    val pack = page.products.single().pack!!
    assertThat(pack.unitPricePaise).isEqualTo(25000L)
    assertThat(pack.mrpPaise).isEqualTo(30000L)
    assertThat(pack.moq).isEqualTo(4)
    assertThat(pack.packName).isEqualTo("500g")
    assertThat(pack.unitsPerCase).isEqualTo(4)
    assertThat(pack.tiers).hasSize(2)
    assertThat(pack.tiers.first().unitPricePaise).isEqualTo(24000L)
    assertThat(pack.tiers.last().maxQuantity).isNull()
  }

  @Test
  fun `maps an unknown availability value to unknown, never to in stock`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(
      envelope(
        listOf(
          productDto(id = "a", pack = packDto { copy(availability = "low_stock") }),
          productDto(id = "b", pack = packDto { copy(availability = "out_of_stock") }),
          productDto(id = "c", pack = packDto { copy(availability = "") }),
        ),
      ),
    )

    val page = (catalogRepository(api, dispatcher).loadProducts(CatalogQuery.DEFAULT, null) as AppResult.Success).value
    advanceUntilIdle()

    assertThat(page.products.map { it.pack!!.availability }).containsExactly(
      PackAvailability.UNKNOWN,
      PackAvailability.OUT_OF_STOCK,
      PackAvailability.UNKNOWN,
    ).inOrder()
  }

  @Test
  fun `keeps a null price null instead of defaulting it to zero`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.productPages.addLast(
      envelope(
        listOf(
          productDto(pack = packDto { copy(unitPricePaise = null, mrpPaise = null) }),
          productDto(id = "nopack", pack = null),
        ),
      ),
    )

    val page = (catalogRepository(api, dispatcher).loadProducts(CatalogQuery.DEFAULT, null) as AppResult.Success).value
    advanceUntilIdle()

    assertThat(page.products[0]!!.pack!!.unitPricePaise).isNull()
    assertThat(page.products[0]!!.pack!!.mrpPaise).isNull()
    // No active pack: browse-only, with no price block to misread.
    assertThat(page.products[1]!!.pack).isNull()
  }

  @Test
  fun `turns a transport failure into a retryable offline error`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.nextProductFailure = IOException("no route to host")

    val result = catalogRepository(api, dispatcher).loadProducts(CatalogQuery.DEFAULT, null)
    advanceUntilIdle()

    val error = (result as AppResult.Failure).error
    assertThat(error).isInstanceOf(AppError.Network::class.java)
    assertThat(error.retryable).isTrue()
    assertThat(error.isOffline).isTrue()
  }

  @Test
  fun `maps the home payload`() = runTest(dispatcher) {
    val api = FakeCatalogApi()
    api.homeResult = ApiEnvelope(
      com.maharanitraders.core.network.dto.RetailerHomeDto(
        banners = listOf(
          com.maharanitraders.core.network.dto.PromoBannerDto(
            id = "b1",
            title = "Diwali deals",
            subtitle = "Up to 12% off",
            imageUrl = "https://cdn.maharanitraders.test/storage/v1/object/public/banners/d.jpg",
            ctaLabel = "Shop now",
            linkUrl = "/retailer/catalog",
          ),
          com.maharanitraders.core.network.dto.PromoBannerDto(
            id = "b2",
            title = "External",
            linkUrl = "https://example.com/promo",
          ),
        ),
        categories = listOf(
          com.maharanitraders.core.network.dto.CatalogCategoryDto(
            id = "c1", name = "Rice", productCount = 12,
          ),
          com.maharanitraders.core.network.dto.CatalogCategoryDto(
            id = "c2", name = "Oils", productCount = null,
          ),
        ),
        products = listOf(productDto()),
        nextCursor = "next",
      ),
    )

    val home = (catalogRepository(api, dispatcher).loadHome() as AppResult.Success).value
    advanceUntilIdle()

    assertThat(home.banners).hasSize(2)
    assertThat(home.banners[0]!!.isNavigable).isTrue()
    // An http(s) link is not a route the native shell can open, so it is not
    // advertised as tappable.
    assertThat(home.banners[1]!!.isNavigable).isFalse()
    assertThat(home.categories[0]!!.productCount).isEqualTo(12)
    // A missing aggregate stays missing rather than becoming a fake zero.
    assertThat(home.categories[1]!!.productCount).isNull()
    assertThat(home.products).hasSize(1)
    assertThat(home.nextCursor).isEqualTo("next")
  }
}
