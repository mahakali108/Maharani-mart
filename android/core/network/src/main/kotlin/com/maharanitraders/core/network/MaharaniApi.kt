package com.maharanitraders.core.network

import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AreasDto
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.CartLineRequestDto
import com.maharanitraders.core.network.dto.CartQuantityRequestDto
import com.maharanitraders.core.network.dto.CheckoutQuoteDto
import com.maharanitraders.core.network.dto.CheckoutQuoteRequestDto
import com.maharanitraders.core.network.dto.CouponRequestDto
import com.maharanitraders.core.network.dto.CouponResultDto
import com.maharanitraders.core.network.dto.CouponRemovedDto
import com.maharanitraders.core.network.dto.FavoriteToggleRequestDto
import com.maharanitraders.core.network.dto.FavoriteToggleResponseDto
import com.maharanitraders.core.network.dto.MarkReadRequestDto
import com.maharanitraders.core.network.dto.MarkReadResponseDto
import com.maharanitraders.core.network.dto.MobileAddressesDto
import com.maharanitraders.core.network.dto.MobileCartDto
import com.maharanitraders.core.network.dto.MobileCouponsDto
import com.maharanitraders.core.network.dto.MobileFavoritesDto
import com.maharanitraders.core.network.dto.MobileNotificationDto
import com.maharanitraders.core.network.dto.MobileOrderDto
import com.maharanitraders.core.network.dto.MobileWalletLedgerEntryDto
import com.maharanitraders.core.network.dto.MobileWalletSummaryDto
import com.maharanitraders.core.network.dto.OrderConfirmationDto
import com.maharanitraders.core.network.dto.PlaceOrderRequestDto
import com.maharanitraders.core.network.dto.PlaceOrderResponseDto
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
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
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
   * Cart and order history use dedicated Phase E endpoints and are NOT part of
   * this discovery response. Coins wallet/history and schemes remain later
   * work, and an empty `banners` list is a normal answer rather than a failure.
   */
  @GET("api/mobile/v1/home")
  suspend fun retailerHome(): ApiEnvelope<RetailerHomeDto>

  // -------------------------------------------------------------------------
  // Phase E — server-owned cart, quote, order submission and history
  // -------------------------------------------------------------------------

  /** The caller's persistent shared cart, re-priced by the server on every read. */
  @GET("api/mobile/v1/cart")
  suspend fun mobileCart(): ApiEnvelope<MobileCartDto>

  /** Adds the requested piece quantity to the caller's shared cart. */
  @POST("api/mobile/v1/cart/lines")
  suspend fun addCartLine(@Body body: CartLineRequestDto): ApiEnvelope<MobileCartDto>

  /** Sets a saved line's final piece count; the server rechecks its MOQ. */
  @PATCH("api/mobile/v1/cart/lines/{lineId}")
  suspend fun updateCartLine(
    @Path("lineId") lineId: String,
    @Body body: CartQuantityRequestDto,
  ): ApiEnvelope<MobileCartDto>

  @DELETE("api/mobile/v1/cart/lines/{lineId}")
  suspend fun removeCartLine(@Path("lineId") lineId: String): ApiEnvelope<MobileCartDto>

  @POST("api/mobile/v1/cart/coupon")
  suspend fun applyCartCoupon(@Body body: CouponRequestDto): ApiEnvelope<CouponResultDto>

  @DELETE("api/mobile/v1/cart/coupon")
  suspend fun removeCartCoupon(): ApiEnvelope<CouponRemovedDto>

  @GET("api/mobile/v1/addresses")
  suspend fun mobileAddresses(): ApiEnvelope<MobileAddressesDto>

  /** A no-write server quote over the exact shared-cart intent. */
  @POST("api/mobile/v1/checkout/quote")
  suspend fun checkoutQuote(@Body body: CheckoutQuoteRequestDto): ApiEnvelope<CheckoutQuoteDto>

  /**
   * Place one order. The persisted UUID header must remain unchanged for every
   * retry of this exact logical submission; OkHttp never retries mutations.
   */
  @POST("api/mobile/v1/orders")
  suspend fun placeOrder(
    @Header("Idempotency-Key") requestKey: String,
    @Body body: PlaceOrderRequestDto,
  ): ApiEnvelope<PlaceOrderResponseDto>

  @GET("api/mobile/v1/orders")
  suspend fun orderHistory(@Query("cursor") cursor: String? = null): ApiEnvelope<List<MobileOrderDto>>

  @GET("api/mobile/v1/orders/{id}")
  suspend fun orderDetail(@Path("id") orderId: String): ApiEnvelope<MobileOrderDto>

  /** Recover a committed order when the submit response was uncertain. */
  @GET("api/mobile/v1/orders/requests/{requestKey}")
  suspend fun recoverOrderRequest(@Path("requestKey") requestKey: String): ApiEnvelope<MobileOrderDto>

  // -------------------------------------------------------------------------Phase F — engagement: notifications, wallet, favorites, coupons
  // -------------------------------------------------------------------------

  @GET("api/mobile/v1/notifications")
  suspend fun notifications(
    @Query("cursor") cursor: String? = null,
    @Query("unreadOnly") unreadOnly: String? = null,
  ): ApiEnvelope<List<MobileNotificationDto>>

  @POST("api/mobile/v1/notifications/read")
  suspend fun markNotificationsRead(
    @Body body: MarkReadRequestDto,
  ): ApiEnvelope<MarkReadResponseDto>

  @GET("api/mobile/v1/wallet")
  suspend fun walletSummary(): ApiEnvelope<MobileWalletSummaryDto>

  @GET("api/mobile/v1/wallet/ledger")
  suspend fun walletLedger(
    @Query("cursor") cursor: String? = null,
  ): ApiEnvelope<List<MobileWalletLedgerEntryDto>>

  @GET("api/mobile/v1/favorites")
  suspend fun favorites(): ApiEnvelope<MobileFavoritesDto>

  @POST("api/mobile/v1/favorites")
  suspend fun toggleFavorite(
    @Body body: FavoriteToggleRequestDto,
  ): ApiEnvelope<FavoriteToggleResponseDto>

  @GET("api/mobile/v1/coupons")
  suspend fun coupons(): ApiEnvelope<MobileCouponsDto>
}
