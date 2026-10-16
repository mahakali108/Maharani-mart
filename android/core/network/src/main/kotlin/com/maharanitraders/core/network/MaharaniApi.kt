package com.maharanitraders.core.network

import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.AddressPayloadDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AreasDto
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.CatalogSearchDto
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
import com.maharanitraders.core.network.dto.MobileAddressMutationDto
import com.maharanitraders.core.network.dto.MobileAddressesDto
import com.maharanitraders.core.network.dto.MobileBulkMatchDto
import com.maharanitraders.core.network.dto.MobileBulkMatchRequestDto
import com.maharanitraders.core.network.dto.MobileCartDto
import com.maharanitraders.core.network.dto.MobileQuickOrderDto
import com.maharanitraders.core.network.dto.MobileCouponsDto
import com.maharanitraders.core.network.dto.MobileFavoritesDto
import com.maharanitraders.core.network.dto.MobileNotificationDto
import com.maharanitraders.core.network.dto.MobileDeliveryDto
import com.maharanitraders.core.network.dto.MobileInvoiceDto
import com.maharanitraders.core.network.dto.MobileOrderDto
import com.maharanitraders.core.network.dto.MobileWalletLedgerEntryDto
import com.maharanitraders.core.network.dto.MobileWalletSummaryDto
import com.maharanitraders.core.network.dto.MobileRetailerProfileDto
import com.maharanitraders.core.network.dto.MobileProfilePatchDto
import com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto
import com.maharanitraders.core.network.dto.MobileSchemesDto
import com.maharanitraders.core.network.dto.MobileHelpDto
import com.maharanitraders.core.network.dto.MobileReportsDto
import com.maharanitraders.core.network.dto.MobileSupportTicketsDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDetailDto
import com.maharanitraders.core.network.dto.MobileSupportCreateRequestDto
import com.maharanitraders.core.network.dto.MobileSupportCreateResponseDto
import com.maharanitraders.core.network.dto.MobileSupportReplyRequestDto
import com.maharanitraders.core.network.dto.MobileSupportMessageDto
import com.maharanitraders.core.network.dto.MobileSavedCartsDto
import com.maharanitraders.core.network.dto.MobileSavedCartCreateRequestDto
import com.maharanitraders.core.network.dto.MobileSavedCartRenameRequestDto
import com.maharanitraders.core.network.dto.MobileSavedCartMutationDto
import com.maharanitraders.core.network.dto.MobileSavedCartRestoreDto
import com.maharanitraders.core.network.dto.MobileSaveForLaterRequestDto
import com.maharanitraders.core.network.dto.MobileOrderActionRequestDto
import com.maharanitraders.core.network.dto.MobileReturnRequestResponseDto
import com.maharanitraders.core.network.dto.MobileAccountRequestsDto
import com.maharanitraders.core.network.dto.MobileAccountRequestCreateDto
import com.maharanitraders.core.network.dto.MobileAccountRequestDto
import com.maharanitraders.core.network.dto.OrderConfirmationDto
import com.maharanitraders.core.network.dto.PlaceOrderRequestDto
import com.maharanitraders.core.network.dto.PlaceOrderResponseDto
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import com.maharanitraders.core.network.dto.LoginRequestDto
import com.maharanitraders.core.network.dto.PasswordResetRequestDto
import com.maharanitraders.core.network.dto.PasswordUpdateRequestDto
import com.maharanitraders.core.network.dto.PasswordChangeRequestDto
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
import retrofit2.http.Streaming
import okhttp3.ResponseBody

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

  /** In-account rotation; the server re-authenticates the current credential before updating. */
  @POST("api/mobile/v1/auth/password-change")
  suspend fun changePassword(@Body body: PasswordChangeRequestDto): ApiEnvelope<AckDto>

  @POST("api/mobile/v1/auth/logout-all")
  suspend fun revokeAllSessions(): ApiEnvelope<AckDto>

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
    /**
     * `1` restricts the page to the caller's saved favourites.
     *
     * The web catalogue's own `fav=1` filter, reused rather than reimplemented:
     * the favourites screen is this list filtered, so a favourited product is
     * priced and stocked exactly as it is everywhere else.
     */
    @Query("fav") favoritesOnly: String? = null,
    /**
     * The derived filters below are the ones the SERVER resolves against the
     * price it computed for THIS retailer (`lib/mobile/catalog.ts` →
     * `parseCatalogQuery`, applied in `lib/retailer/catalog-batches.ts`).
     *
     * None of them can be applied on the device: a price band, a discount floor
     * or an MOQ ceiling compares against a rate that only exists after the
     * retailer/area override and the slab table have been resolved, and pushing
     * them into the query is what keeps the list the shopper sees identical to
     * the list checkout would honour. Every one is nullable, and Retrofit omits
     * nulls, so an unset filter is never sent as a zero bound.
     */
    @Query("minPrice") minPrice: String? = null,
    @Query("maxPrice") maxPrice: String? = null,
    @Query("discount") minDiscount: String? = null,
    @Query("maxMoq") maxMoq: String? = null,
    /** `1` restricts the page to rows carrying an offer or a real MRP discount. */
    @Query("offers") offersOnly: String? = null,
    /** `1` restricts the page to the admin's new-launch rows. */
    @Query("new") newOnly: String? = null,
    @Query("cursor") cursor: String? = null,
  ): ApiEnvelope<List<CatalogProductDto>>

  /**
   * Cross-entity search suggestions: products (by name or product barcode),
   * packs (by pack name or pack barcode, folded onto their parent product),
   * brands and categories.
   *
   * This is the SAME four-read answer the web storefront's suggestion loader
   * gives, and it is navigation-only: no price, stock or MOQ crosses this
   * boundary, so a suggestion can never quote a number the priced row would
   * contradict. A failed read is a 503 the caller must report as a failure —
   * never as "no results".
   */
  @GET("api/mobile/v1/catalog/search")
  suspend fun catalogSearch(@Query("q") search: String): ApiEnvelope<CatalogSearchDto>

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
   * The retailer home payload: admin-published banners, the admin's LIVE offers,
   * the real category and brand strips, and the first catalogue batch.
   *
   * Cart, order history, Coins and notifications use their own endpoints and are
   * NOT part of this discovery response — the home dashboard reads them
   * separately so one outage cannot blank the shop. An empty `banners` list and
   * an empty `schemes` list are both normal answers rather than failures;
   * `schemesUnavailable` is the flag that says the offer read itself failed.
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

  /**
   * Save a new delivery address. The body carries only the address fields —
   * the owner is the verified session on the server, never a client value.
   */
  @POST("api/mobile/v1/addresses")
  suspend fun createAddress(@Body body: AddressPayloadDto): ApiEnvelope<MobileAddressMutationDto>

  /** Edit one of the caller's own saved addresses. */
  @PATCH("api/mobile/v1/addresses/{addressId}")
  suspend fun updateAddress(
    @Path("addressId") addressId: String,
    @Body body: AddressPayloadDto,
  ): ApiEnvelope<MobileAddressMutationDto>

  /** Remove one of the caller's own saved addresses. */
  @DELETE("api/mobile/v1/addresses/{addressId}")
  suspend fun deleteAddress(@Path("addressId") addressId: String): ApiEnvelope<MobileAddressesDto>

  /** Make one saved address the exclusive default. */
  @POST("api/mobile/v1/addresses/{addressId}/default")
  suspend fun setDefaultAddress(@Path("addressId") addressId: String): ApiEnvelope<MobileAddressMutationDto>

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

  /**
   * Non-tax-invoice order summary for one owned order (legacy URL).
   * The server returns stored figures in integer paise; the app does not
   * derive a tax component or infer an issuer.
   */
  @GET("api/mobile/v1/orders/{id}/invoice")
  suspend fun orderInvoice(@Path("id") orderId: String): ApiEnvelope<MobileInvoiceDto>

  /**
   * The delivery record for one owned order: status timeline, proof and the
   * server-decided return window.
   */
  @GET("api/mobile/v1/orders/{id}/delivery")
  suspend fun orderDelivery(@Path("id") orderId: String): ApiEnvelope<MobileDeliveryDto>

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

  @GET("api/mobile/v1/quick-order")
  suspend fun quickOrder(@Query("q") q: String): ApiEnvelope<MobileQuickOrderDto>

  @POST("api/mobile/v1/quick-order/match")
  suspend fun matchBulkLines(
    @Body body: MobileBulkMatchRequestDto,
  ): ApiEnvelope<MobileBulkMatchDto>

  @GET("api/mobile/v1/favorites")
  suspend fun favorites(): ApiEnvelope<MobileFavoritesDto>

  @POST("api/mobile/v1/favorites")
  suspend fun toggleFavorite(
    @Body body: FavoriteToggleRequestDto,
  ): ApiEnvelope<FavoriteToggleResponseDto>

  @GET("api/mobile/v1/coupons")
  suspend fun coupons(): ApiEnvelope<MobileCouponsDto>

  // -------------------------------------------------------------------------
  // Native retailer upgrade — account, schemes, reports and support
  // -------------------------------------------------------------------------

  @GET("api/mobile/v1/profile")
  suspend fun retailerProfile(): ApiEnvelope<MobileRetailerProfileDto>

  @PATCH("api/mobile/v1/profile")
  suspend fun updateRetailerProfile(@Body body: MobileProfilePatchDto): ApiEnvelope<AckDto>

  @GET("api/mobile/v1/notifications/preferences")
  suspend fun notificationPreferences(): ApiEnvelope<MobileNotificationPreferencesDto>

  @PATCH("api/mobile/v1/notifications/preferences")
  suspend fun updateNotificationPreferences(
    @Body body: MobileNotificationPreferencesDto,
  ): ApiEnvelope<AckDto>

  @GET("api/mobile/v1/schemes")
  suspend fun schemes(): ApiEnvelope<MobileSchemesDto>

  @GET("api/mobile/v1/help")
  suspend fun helpDetails(): ApiEnvelope<MobileHelpDto>

  @GET("api/mobile/v1/account/requests")
  suspend fun accountRequests(): ApiEnvelope<MobileAccountRequestsDto>

  @POST("api/mobile/v1/account/requests")
  suspend fun createAccountRequest(@Body body: MobileAccountRequestCreateDto): ApiEnvelope<MobileAccountRequestDto>

  @GET("api/mobile/v1/reports")
  suspend fun purchaseReports(): ApiEnvelope<MobileReportsDto>

  /** Server-generated statement CSV; authentication is still the bearer interceptor. */
  @Streaming
  @GET("api/mobile/v1/reports/statement")
  suspend fun reportStatementCsv(
    @Query("type") type: String,
    @Query("from") from: String? = null,
    @Query("to") to: String? = null,
  ): ResponseBody

  @GET("api/mobile/v1/support/tickets")
  suspend fun supportTickets(
    @Query("cursor") cursor: String? = null,
    @Query("status") status: String? = null,
  ): ApiEnvelope<List<MobileSupportTicketDto>>

  @POST("api/mobile/v1/support/tickets")
  suspend fun createSupportTicket(@Body body: MobileSupportCreateRequestDto): ApiEnvelope<MobileSupportCreateResponseDto>

  @GET("api/mobile/v1/support/tickets/{id}")
  suspend fun supportTicket(@Path("id") ticketId: String): ApiEnvelope<MobileSupportTicketDetailDto>

  @POST("api/mobile/v1/support/tickets/{id}")
  suspend fun replyToSupportTicket(
    @Path("id") ticketId: String,
    @Body body: MobileSupportReplyRequestDto,
  ): ApiEnvelope<MobileSupportMessageDto>

  @GET("api/mobile/v1/saved-carts")
  suspend fun savedCarts(): ApiEnvelope<MobileSavedCartsDto>

  @POST("api/mobile/v1/saved-carts")
  suspend fun saveCurrentCart(@Body body: MobileSavedCartCreateRequestDto): ApiEnvelope<MobileSavedCartMutationDto>

  @PATCH("api/mobile/v1/saved-carts/{id}")
  suspend fun renameSavedCart(
    @Path("id") savedCartId: String,
    @Body body: MobileSavedCartRenameRequestDto,
  ): ApiEnvelope<AckDto>

  @DELETE("api/mobile/v1/saved-carts/{id}")
  suspend fun deleteSavedCart(@Path("id") savedCartId: String): ApiEnvelope<AckDto>

  @POST("api/mobile/v1/saved-carts/{id}/restore")
  suspend fun restoreSavedCart(@Path("id") savedCartId: String): ApiEnvelope<MobileSavedCartRestoreDto>

  @POST("api/mobile/v1/saved-carts/items")
  suspend fun saveCartItemForLater(@Body body: MobileSaveForLaterRequestDto): ApiEnvelope<MobileSavedCartMutationDto>

  @DELETE("api/mobile/v1/saved-carts/items/{itemId}")
  suspend fun deleteSavedCartItem(@Path("itemId") itemId: String): ApiEnvelope<AckDto>

  @POST("api/mobile/v1/saved-carts/items/{itemId}/restore")
  suspend fun restoreSavedCartItem(@Path("itemId") itemId: String): ApiEnvelope<MobileSavedCartRestoreDto>

  @POST("api/mobile/v1/orders/{id}/cancel")
  suspend fun cancelOrder(
    @Path("id") orderId: String,
    @Body body: MobileOrderActionRequestDto,
  ): ApiEnvelope<AckDto>

  @POST("api/mobile/v1/orders/{id}/return")
  suspend fun requestOrderReturn(
    @Path("id") orderId: String,
    @Body body: MobileOrderActionRequestDto,
  ): ApiEnvelope<MobileReturnRequestResponseDto>
}
