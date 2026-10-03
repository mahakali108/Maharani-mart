package com.maharanitraders.core.network

import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AreasDto
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import com.maharanitraders.core.network.dto.LoginRequestDto
import com.maharanitraders.core.network.dto.PasswordResetRequestDto
import com.maharanitraders.core.network.dto.PasswordUpdateRequestDto
import com.maharanitraders.core.network.dto.RefreshRequestDto
import com.maharanitraders.core.network.dto.RefreshSessionDto
import com.maharanitraders.core.network.dto.RegisterRetailerRequestDto
import com.maharanitraders.core.network.dto.RegisterRetailerResponseDto
import com.maharanitraders.core.network.dto.SessionDto
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The versioned mobile API surface.
 *
 * Phase B exposed the two bootstrap endpoints. Phase C adds real authentication:
 * sign-in, token refresh, sign-out, password reset/change and retailer
 * registration.
 *
 * Authorization is applied by [AuthInterceptor] from the in-memory token held by
 * the session layer — no call site passes a token, so a token cannot end up in
 * a URL, a log line or a crash report.
 *
 * Endpoints that must work WITHOUT a session (login, refresh, reset, register)
 * are listed in [AuthInterceptor]'s allow-list reasoning: the interceptor simply
 * omits the header when no token is held, and the server is the authority on
 * which endpoints require one.
 */
interface MaharaniApi {

  @GET("api/mobile/v1/health")
  suspend fun health(): ApiEnvelope<HealthDto>

  @GET("api/mobile/v1/session")
  suspend fun session(): ApiEnvelope<SessionDto>

  // -------------------------------------------------------------------------
  // Phase C — authentication
  // -------------------------------------------------------------------------

  @POST("api/mobile/v1/auth/login")
  suspend fun login(@Body body: LoginRequestDto): ApiEnvelope<AuthSessionDto>

  /**
   * Exchange a refresh token for a new pair.
   *
   * Deliberately returns tokens only: account state can change while a token is
   * being refreshed, so entitlement is re-read from [session] instead of being
   * cached from a refresh response.
   */
  @POST("api/mobile/v1/auth/refresh")
  suspend fun refresh(@Body body: RefreshRequestDto): ApiEnvelope<RefreshSessionDto>

  @POST("api/mobile/v1/auth/logout")
  suspend fun logout(): ApiEnvelope<AckDto>

  @POST("api/mobile/v1/auth/password-reset")
  suspend fun requestPasswordReset(@Body body: PasswordResetRequestDto): ApiEnvelope<AckDto>

  @POST("api/mobile/v1/auth/password-update")
  suspend fun updatePassword(@Body body: PasswordUpdateRequestDto): ApiEnvelope<AckDto>

  /**
   * Active service areas. Public by design: a prospective retailer has no
   * account yet, and the list is master data already visible on the website.
   */
  @GET("api/mobile/v1/areas")
  suspend fun areas(): ApiEnvelope<AreasDto>

  @POST("api/mobile/v1/retailers/register")
  suspend fun registerRetailer(
    @Body body: RegisterRetailerRequestDto,
  ): ApiEnvelope<RegisterRetailerResponseDto>

  // -------------------------------------------------------------------------
  // Phase D - catalogue
  // -------------------------------------------------------------------------
  //
  // All five are retailer-scoped on the server, priced for the CALLING
  // retailer, and answer with the standard envelope. The list endpoint returns
  // `data` as a bare array with a sibling `page` block (contract 1.3), so the
  // cursor lives on the envelope rather than inside the payload.
  //
  // Every parameter is nullable and Retrofit omits nulls, so a request carries
  // only the filters the shopper actually set. There is deliberately no
  // retailer id, area id, role or price parameter: identity and pricing are the
  // server's business.

  @GET("api/mobile/v1/catalog/products")
  suspend fun catalogProducts(
    @Query("q") search: String? = null,
    @Query("categoryId") categoryId: String? = null,
    @Query("brandId") brandId: String? = null,
    @Query("sort") sort: String? = null,
    @Query("inStock") inStock: String? = null,
    @Query("cursor") cursor: String? = null,
  ): ApiEnvelope<List<CatalogProductDto>>

  /**
   * One product with every active pack priced at its own MOQ.
   *
   * [id] may be a product id or a pack id - the catalogue links to the variant
   * the shopper was looking at, and a pack id additionally marks that pack as
   * selected. The server answers `404 not_found` for an id that does not exist
   * and for one the caller may not see, without distinguishing them.
   */
  @GET("api/mobile/v1/catalog/products/{id}")
  suspend fun catalogProduct(@Path("id") id: String): ApiEnvelope<ProductDetailDto>

  @GET("api/mobile/v1/catalog/categories")
  suspend fun catalogCategories(): ApiEnvelope<CatalogCategoriesDto>

  @GET("api/mobile/v1/catalog/brands")
  suspend fun catalogBrands(): ApiEnvelope<CatalogBrandsDto>

  /**
   * The retailer home payload: admin-published banners, the real category strip
   * and the first catalogue batch.
   *
   * Cart, coins, recent orders and schemes are NOT part of this response - they
   * belong to later phases, and an empty `banners` list is a normal answer
   * rather than a failure.
   */
  @GET("api/mobile/v1/home")
  suspend fun retailerHome(): ApiEnvelope<RetailerHomeDto>
}
