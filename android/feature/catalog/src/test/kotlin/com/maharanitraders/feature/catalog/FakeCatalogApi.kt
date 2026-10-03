package com.maharanitraders.feature.catalog

import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AreasDto
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.LoginRequestDto
import com.maharanitraders.core.network.dto.PageDto
import com.maharanitraders.core.network.dto.ListMetaDto
import com.maharanitraders.core.network.dto.PasswordResetRequestDto
import com.maharanitraders.core.network.dto.PasswordUpdateRequestDto
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.RefreshRequestDto
import com.maharanitraders.core.network.dto.RefreshSessionDto
import com.maharanitraders.core.network.dto.RegisterRetailerRequestDto
import com.maharanitraders.core.network.dto.RegisterRetailerResponseDto
import com.maharanitraders.core.network.dto.RetailerDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import com.maharanitraders.core.network.dto.SessionDto
import com.maharanitraders.core.network.dto.SessionUserDto
import com.maharanitraders.core.network.dto.NavigationDto

/**
 * A [MaharaniApi] double for the catalogue tests.
 *
 * It implements EVERY member of the interface — the static guard in
 * `tests/android-project-integrity.test.ts` fails the build otherwise, which is
 * exactly the point: when a phase adds an endpoint, every double is updated in
 * the same change rather than silently drifting.
 *
 * Endpoints the catalogue never calls throw rather than return a fabricated
 * envelope, so a test that starts depending on one by accident fails loudly
 * instead of passing on invented data.
 */
class FakeCatalogApi : MaharaniApi {

  /** Every product-list request the code under test made, in order. */
  val productRequests: MutableList<ProductRequest> = mutableListOf()
  val homeCalls: Int get() = homeCallCount
  val categoryCalls: Int get() = categoryCallCount
  val productDetailRequests: MutableList<String> = mutableListOf()

  private var homeCallCount = 0
  private var categoryCallCount = 0

  /** Queued responses for [catalogProducts]; consumed oldest-first. */
  val productPages: ArrayDeque<ApiEnvelope<List<CatalogProductDto>>> = ArrayDeque()
  var nextProductFailure: Throwable? = null

  var homeResult: ApiEnvelope<RetailerHomeDto> = ApiEnvelope(RetailerHomeDto())
  var nextHomeFailure: Throwable? = null

  var categoriesResult: ApiEnvelope<CatalogCategoriesDto> = ApiEnvelope(CatalogCategoriesDto())

  var detailResult: ApiEnvelope<ProductDetailDto>? = null
  var nextDetailFailure: Throwable? = null

  data class ProductRequest(
    val search: String?,
    val categoryId: String?,
    val brandId: String?,
    val sort: String?,
    val inStock: String?,
    val cursor: String?,
  )

  override suspend fun catalogProducts(
    search: String?,
    categoryId: String?,
    brandId: String?,
    sort: String?,
    inStock: String?,
    cursor: String?,
  ): ApiEnvelope<List<CatalogProductDto>> {
    productRequests.add(ProductRequest(search, categoryId, brandId, sort, inStock, cursor))
    nextProductFailure?.let { throw it }
    return productPages.removeFirstOrNull() ?: ApiEnvelope(emptyList(), page = PageDto(hasMore = false))
  }

  override suspend fun catalogProduct(id: String): ApiEnvelope<ProductDetailDto> {
    productDetailRequests.add(id)
    nextDetailFailure?.let { throw it }
    return detailResult ?: throw IllegalStateException("detail not configured for $id")
  }

  override suspend fun catalogCategories(): ApiEnvelope<CatalogCategoriesDto> {
    categoryCallCount += 1
    return categoriesResult
  }

  override suspend fun catalogBrands(): ApiEnvelope<CatalogBrandsDto> =
    ApiEnvelope(CatalogBrandsDto())

  override suspend fun retailerHome(): ApiEnvelope<RetailerHomeDto> {
    homeCallCount += 1
    nextHomeFailure?.let { throw it }
    return homeResult
  }

  // -------------------------------------------------------------------------
  // Not reachable from the catalogue layer.
  // -------------------------------------------------------------------------

  override suspend fun health(): ApiEnvelope<HealthDto> = unsupported("health")

  override suspend fun session(): ApiEnvelope<SessionDto> = ApiEnvelope(
    SessionDto(
      user = SessionUserDto(id = "u", email = null, role = "retailer", isActive = true),
      retailer = RetailerDto(status = "active", shopName = "Shop"),
      navigation = NavigationDto(homeRoute = "/retailer/home", workspaces = listOf("retailer")),
    ),
  )

  override suspend fun login(body: LoginRequestDto): ApiEnvelope<AuthSessionDto> = unsupported("login")
  override suspend fun refresh(body: RefreshRequestDto): ApiEnvelope<RefreshSessionDto> = unsupported("refresh")
  override suspend fun logout(): ApiEnvelope<AckDto> = unsupported("logout")
  override suspend fun requestPasswordReset(body: PasswordResetRequestDto): ApiEnvelope<AckDto> =
    unsupported("requestPasswordReset")

  override suspend fun updatePassword(body: PasswordUpdateRequestDto): ApiEnvelope<AckDto> =
    unsupported("updatePassword")

  override suspend fun areas(): ApiEnvelope<AreasDto> = unsupported("areas")
  override suspend fun registerRetailer(
    body: RegisterRetailerRequestDto,
  ): ApiEnvelope<RegisterRetailerResponseDto> = unsupported("registerRetailer")

  private fun unsupported(endpoint: String): Nothing =
    throw UnsupportedOperationException("$endpoint is not used by the catalogue layer")
}
