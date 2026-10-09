package com.maharanitraders.feature.catalog

import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AreasDto
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.CatalogSearchDto
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
import com.maharanitraders.core.network.dto.CartLineRequestDto
import com.maharanitraders.core.network.dto.CartQuantityRequestDto
import com.maharanitraders.core.network.dto.CheckoutQuoteDto
import com.maharanitraders.core.network.dto.CheckoutQuoteRequestDto
import com.maharanitraders.core.network.dto.CouponRequestDto
import com.maharanitraders.core.network.dto.CouponResultDto
import com.maharanitraders.core.network.dto.CouponRemovedDto
import com.maharanitraders.core.network.dto.MobileAddressesDto
import com.maharanitraders.core.network.dto.MobileCartDto
import com.maharanitraders.core.network.dto.MobileDeliveryDto
import com.maharanitraders.core.network.dto.MobileInvoiceDto
import com.maharanitraders.core.network.dto.MobileOrderDto
import com.maharanitraders.core.network.dto.PlaceOrderRequestDto
import com.maharanitraders.core.network.dto.PlaceOrderResponseDto
import kotlinx.coroutines.CompletableDeferred

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
  var nextCategoriesFailure: Throwable? = null

  var brandsResult: ApiEnvelope<CatalogBrandsDto> = ApiEnvelope(CatalogBrandsDto())

  var detailResult: ApiEnvelope<ProductDetailDto>? = null
  var nextDetailFailure: Throwable? = null

  /** Server-side favourite set; [toggleFavorite] mutates it like the API does. */
  val favoriteIds: MutableSet<String> = mutableSetOf()
  val toggleRequests: MutableList<String> = mutableListOf()
  var favoritesCalls: Int = 0
    private set
  var nextFavoritesFailure: Throwable? = null
  var nextToggleFailure: Throwable? = null

  /**
   * When set, [toggleFavorite] waits on it before answering.
   *
   * The fake is otherwise instantaneous, which makes the in-flight window
   * invisible to a test. A gate lets a test hold one toggle open and assert
   * what the UI shows while the server has not replied yet.
   */
  var toggleGate: CompletableDeferred<Unit>? = null

  /**
   * One recorded product-list request, exactly as it left the repository.
   *
   * The derived filters default to `null` so an assertion written before they
   * existed still compares equal for a query that did not set them — and so a
   * test that means "no filter was sent" says so explicitly.
   */
  data class ProductRequest(
    val search: String?,
    val categoryId: String?,
    val brandId: String?,
    val sort: String?,
    val inStock: String?,
    val favoritesOnly: String?,
    val cursor: String?,
    val minPrice: String? = null,
    val maxPrice: String? = null,
    val minDiscount: String? = null,
    val maxMoq: String? = null,
    val offersOnly: String? = null,
    val newOnly: String? = null,
  )

  override suspend fun catalogProducts(
    search: String?,
    categoryId: String?,
    brandId: String?,
    sort: String?,
    inStock: String?,
    favoritesOnly: String?,
    minPrice: String?,
    maxPrice: String?,
    minDiscount: String?,
    maxMoq: String?,
    offersOnly: String?,
    newOnly: String?,
    cursor: String?,
  ): ApiEnvelope<List<CatalogProductDto>> {
    productRequests.add(
      ProductRequest(
        search = search,
        categoryId = categoryId,
        brandId = brandId,
        sort = sort,
        inStock = inStock,
        favoritesOnly = favoritesOnly,
        cursor = cursor,
        minPrice = minPrice,
        maxPrice = maxPrice,
        minDiscount = minDiscount,
        maxMoq = maxMoq,
        offersOnly = offersOnly,
        newOnly = newOnly,
      ),
    )
    nextProductFailure?.let { throw it }
    return productPages.removeFirstOrNull() ?: ApiEnvelope(emptyList(), page = PageDto(hasMore = false))
  }

  /** Every suggestion term requested, in order — a stale-answer test reads this. */
  val searchRequests: MutableList<String> = mutableListOf()
  var searchResult: ApiEnvelope<CatalogSearchDto> = ApiEnvelope(CatalogSearchDto())
  var nextSearchFailure: Throwable? = null
  var searchCalls: Int = 0
    private set

  override suspend fun catalogSearch(search: String): ApiEnvelope<CatalogSearchDto> {
    searchCalls += 1
    searchRequests.add(search)
    nextSearchFailure?.let { throw it }
    return searchResult
  }

  override suspend fun catalogProduct(id: String): ApiEnvelope<ProductDetailDto> {
    productDetailRequests.add(id)
    nextDetailFailure?.let { throw it }
    return detailResult ?: throw IllegalStateException("detail not configured for $id")
  }

  override suspend fun catalogCategories(): ApiEnvelope<CatalogCategoriesDto> {
    categoryCallCount += 1
    nextCategoriesFailure?.let { throw it }
    return categoriesResult
  }

  override suspend fun catalogBrands(): ApiEnvelope<CatalogBrandsDto> = brandsResult

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

  override suspend fun mobileCart(): ApiEnvelope<MobileCartDto> = unsupported("mobileCart")
  override suspend fun addCartLine(body: CartLineRequestDto): ApiEnvelope<MobileCartDto> = unsupported("addCartLine")
  override suspend fun updateCartLine(lineId: String, body: CartQuantityRequestDto): ApiEnvelope<MobileCartDto> =
    unsupported("updateCartLine")
  override suspend fun removeCartLine(lineId: String): ApiEnvelope<MobileCartDto> = unsupported("removeCartLine")
  override suspend fun applyCartCoupon(body: CouponRequestDto): ApiEnvelope<CouponResultDto> = unsupported("applyCartCoupon")
  override suspend fun removeCartCoupon(): ApiEnvelope<CouponRemovedDto> = unsupported("removeCartCoupon")
  override suspend fun mobileAddresses(): ApiEnvelope<MobileAddressesDto> = unsupported("mobileAddresses")
  override suspend fun createAddress(
    body: com.maharanitraders.core.network.dto.AddressPayloadDto,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAddressMutationDto> = unsupported("createAddress")
  override suspend fun updateAddress(
    addressId: String,
    body: com.maharanitraders.core.network.dto.AddressPayloadDto,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAddressMutationDto> = unsupported("updateAddress")
  override suspend fun deleteAddress(addressId: String): ApiEnvelope<MobileAddressesDto> = unsupported("deleteAddress")
  override suspend fun setDefaultAddress(
    addressId: String,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAddressMutationDto> = unsupported("setDefaultAddress")
  override suspend fun checkoutQuote(body: CheckoutQuoteRequestDto): ApiEnvelope<CheckoutQuoteDto> = unsupported("checkoutQuote")
  override suspend fun placeOrder(requestKey: String, body: PlaceOrderRequestDto): ApiEnvelope<PlaceOrderResponseDto> =
    unsupported("placeOrder")
  override suspend fun orderHistory(cursor: String?): ApiEnvelope<List<MobileOrderDto>> = unsupported("orderHistory")
  override suspend fun orderDetail(orderId: String): ApiEnvelope<MobileOrderDto> = unsupported("orderDetail")
  override suspend fun recoverOrderRequest(requestKey: String): ApiEnvelope<MobileOrderDto> = unsupported("recoverOrderRequest")
  override suspend fun orderInvoice(orderId: String): ApiEnvelope<MobileInvoiceDto> = unsupported("orderInvoice")
  override suspend fun orderDelivery(orderId: String): ApiEnvelope<MobileDeliveryDto> = unsupported("orderDelivery")

  override suspend fun notifications(cursor: String?, unreadOnly: String?): ApiEnvelope<List<com.maharanitraders.core.network.dto.MobileNotificationDto>> = unsupported("notifications")
  override suspend fun markNotificationsRead(body: com.maharanitraders.core.network.dto.MarkReadRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MarkReadResponseDto> = unsupported("markNotificationsRead")
  override suspend fun walletSummary(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileWalletSummaryDto> = unsupported("walletSummary")
  override suspend fun walletLedger(cursor: String?): ApiEnvelope<List<com.maharanitraders.core.network.dto.MobileWalletLedgerEntryDto>> = unsupported("walletLedger")
  // Favourites ARE reachable from the catalogue layer: `FavoritesStore` lives
  // here because the catalogue owns products, so these two answer for real.
  override suspend fun favorites(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileFavoritesDto> {
    favoritesCalls += 1
    nextFavoritesFailure?.let { throw it }
    return ApiEnvelope(
      com.maharanitraders.core.network.dto.MobileFavoritesDto(productIds = favoriteIds.toList()),
    )
  }

  override suspend fun toggleFavorite(
    body: com.maharanitraders.core.network.dto.FavoriteToggleRequestDto,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.FavoriteToggleResponseDto> {
    toggleRequests.add(body.productId)
    toggleGate?.await()
    nextToggleFailure?.let { throw it }
    // Mirror the server: toggling flips the stored state and REPORTS the result.
    val nowFavorite = !favoriteIds.contains(body.productId)
    if (nowFavorite) favoriteIds.add(body.productId) else favoriteIds.remove(body.productId)
    return ApiEnvelope(
      com.maharanitraders.core.network.dto.FavoriteToggleResponseDto(isFavorite = nowFavorite),
    )
  }

  override suspend fun coupons(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileCouponsDto> = unsupported("coupons")
  override suspend fun quickOrder(
    q: String,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileQuickOrderDto> = unsupported("quickOrder")
  override suspend fun matchBulkLines(
    body: com.maharanitraders.core.network.dto.MobileBulkMatchRequestDto,
  ): ApiEnvelope<com.maharanitraders.core.network.dto.MobileBulkMatchDto> = unsupported("matchBulkLines")


  override suspend fun changePassword(body: com.maharanitraders.core.network.dto.PasswordChangeRequestDto): ApiEnvelope<AckDto> = unsupported("changePassword")
  override suspend fun revokeAllSessions(): ApiEnvelope<AckDto> = unsupported("revokeAllSessions")
  override suspend fun retailerProfile(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileRetailerProfileDto> = unsupported("retailerProfile")
  override suspend fun updateRetailerProfile(body: com.maharanitraders.core.network.dto.MobileProfilePatchDto): ApiEnvelope<AckDto> = unsupported("updateRetailerProfile")
  override suspend fun notificationPreferences(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto> = unsupported("notificationPreferences")
  override suspend fun updateNotificationPreferences(body: com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto): ApiEnvelope<AckDto> = unsupported("updateNotificationPreferences")
  override suspend fun schemes(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSchemesDto> = unsupported("schemes")
  override suspend fun helpDetails(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileHelpDto> = unsupported("helpDetails")
  override suspend fun accountRequests(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAccountRequestsDto> = unsupported("accountRequests")
  override suspend fun createAccountRequest(body: com.maharanitraders.core.network.dto.MobileAccountRequestCreateDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileAccountRequestDto> = unsupported("createAccountRequest")
  override suspend fun purchaseReports(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileReportsDto> = unsupported("purchaseReports")
  override suspend fun reportStatementCsv(type: String, from: String?, to: String?): okhttp3.ResponseBody = unsupported("reportStatementCsv")
  override suspend fun supportTickets(cursor: String?, status: String?): ApiEnvelope<List<com.maharanitraders.core.network.dto.MobileSupportTicketDto>> = unsupported("supportTickets")
  override suspend fun createSupportTicket(body: com.maharanitraders.core.network.dto.MobileSupportCreateRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSupportCreateResponseDto> = unsupported("createSupportTicket")
  override suspend fun supportTicket(ticketId: String): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSupportTicketDetailDto> = unsupported("supportTicket")
  override suspend fun replyToSupportTicket(ticketId: String, body: com.maharanitraders.core.network.dto.MobileSupportReplyRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSupportMessageDto> = unsupported("replyToSupportTicket")
  override suspend fun savedCarts(): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartsDto> = unsupported("savedCarts")
  override suspend fun saveCurrentCart(body: com.maharanitraders.core.network.dto.MobileSavedCartCreateRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartMutationDto> = unsupported("saveCurrentCart")
  override suspend fun renameSavedCart(savedCartId: String, body: com.maharanitraders.core.network.dto.MobileSavedCartRenameRequestDto): ApiEnvelope<AckDto> = unsupported("renameSavedCart")
  override suspend fun deleteSavedCart(savedCartId: String): ApiEnvelope<AckDto> = unsupported("deleteSavedCart")
  override suspend fun restoreSavedCart(savedCartId: String): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartRestoreDto> = unsupported("restoreSavedCart")
  override suspend fun saveCartItemForLater(body: com.maharanitraders.core.network.dto.MobileSaveForLaterRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartMutationDto> = unsupported("saveCartItemForLater")
  override suspend fun deleteSavedCartItem(itemId: String): ApiEnvelope<AckDto> = unsupported("deleteSavedCartItem")
  override suspend fun restoreSavedCartItem(itemId: String): ApiEnvelope<com.maharanitraders.core.network.dto.MobileSavedCartRestoreDto> = unsupported("restoreSavedCartItem")
  override suspend fun cancelOrder(orderId: String, body: com.maharanitraders.core.network.dto.MobileOrderActionRequestDto): ApiEnvelope<AckDto> = unsupported("cancelOrder")
  override suspend fun requestOrderReturn(orderId: String, body: com.maharanitraders.core.network.dto.MobileOrderActionRequestDto): ApiEnvelope<com.maharanitraders.core.network.dto.MobileReturnRequestResponseDto> = unsupported("requestOrderReturn")

  private fun unsupported(endpoint: String): Nothing =
    throw UnsupportedOperationException("$endpoint is not used by the catalogue layer")
}
