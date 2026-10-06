package com.maharanitraders.feature.auth

import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.AddressPayloadDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AreasDto
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.CartLineRequestDto
import com.maharanitraders.core.network.dto.CartQuantityRequestDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.CheckoutQuoteDto
import com.maharanitraders.core.network.dto.CheckoutQuoteRequestDto
import com.maharanitraders.core.network.dto.CouponRemovedDto
import com.maharanitraders.core.network.dto.CouponRequestDto
import com.maharanitraders.core.network.dto.CouponResultDto
import com.maharanitraders.core.network.dto.FavoriteToggleRequestDto
import com.maharanitraders.core.network.dto.FavoriteToggleResponseDto
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.LoginRequestDto
import com.maharanitraders.core.network.dto.MarkReadRequestDto
import com.maharanitraders.core.network.dto.MarkReadResponseDto
import com.maharanitraders.core.network.dto.MobileAddressMutationDto
import com.maharanitraders.core.network.dto.MobileAddressesDto
import com.maharanitraders.core.network.dto.MobileBulkMatchDto
import com.maharanitraders.core.network.dto.MobileBulkMatchRequestDto
import com.maharanitraders.core.network.dto.MobileCartDto
import com.maharanitraders.core.network.dto.MobileCouponsDto
import com.maharanitraders.core.network.dto.MobileDeliveryDto
import com.maharanitraders.core.network.dto.MobileFavoritesDto
import com.maharanitraders.core.network.dto.MobileInvoiceDto
import com.maharanitraders.core.network.dto.MobileNotificationDto
import com.maharanitraders.core.network.dto.MobileOrderDto
import com.maharanitraders.core.network.dto.MobileQuickOrderDto
import com.maharanitraders.core.network.dto.MobileWalletLedgerEntryDto
import com.maharanitraders.core.network.dto.MobileWalletSummaryDto
import com.maharanitraders.core.network.dto.PasswordResetRequestDto
import com.maharanitraders.core.network.dto.PasswordChangeRequestDto
import com.maharanitraders.core.network.dto.MobileRetailerProfileDto
import com.maharanitraders.core.network.dto.MobileProfilePatchDto
import com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto
import com.maharanitraders.core.network.dto.MobileSchemesDto
import com.maharanitraders.core.network.dto.MobileHelpDto
import com.maharanitraders.core.network.dto.MobileAccountRequestsDto
import com.maharanitraders.core.network.dto.MobileAccountRequestDto
import com.maharanitraders.core.network.dto.MobileAccountRequestCreateDto
import com.maharanitraders.core.network.dto.MobileReportsDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDto
import com.maharanitraders.core.network.dto.MobileSupportCreateResponseDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDetailDto
import com.maharanitraders.core.network.dto.MobileSupportMessageDto
import com.maharanitraders.core.network.dto.MobileSupportCreateRequestDto
import com.maharanitraders.core.network.dto.MobileSupportReplyRequestDto
import com.maharanitraders.core.network.dto.MobileSavedCartsDto
import com.maharanitraders.core.network.dto.MobileSavedCartCreateRequestDto
import com.maharanitraders.core.network.dto.MobileSavedCartMutationDto
import com.maharanitraders.core.network.dto.MobileSavedCartRenameRequestDto
import com.maharanitraders.core.network.dto.MobileSavedCartRestoreDto
import com.maharanitraders.core.network.dto.MobileSaveForLaterRequestDto
import com.maharanitraders.core.network.dto.MobileOrderActionRequestDto
import com.maharanitraders.core.network.dto.MobileReturnRequestResponseDto
import com.maharanitraders.core.network.dto.PasswordUpdateRequestDto
import com.maharanitraders.core.network.dto.PlaceOrderRequestDto
import com.maharanitraders.core.network.dto.PlaceOrderResponseDto
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.RefreshRequestDto
import com.maharanitraders.core.network.dto.RefreshSessionDto
import com.maharanitraders.core.network.dto.RegisterRetailerRequestDto
import com.maharanitraders.core.network.dto.RegisterRetailerResponseDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import com.maharanitraders.core.network.dto.SessionDto
import kotlinx.coroutines.CompletableDeferred
import okhttp3.ResponseBody

/**
 * A [MaharaniApi] double for the auth-feature ViewModel tests.
 *
 * It implements EVERY member of the interface — the static guard in
 * `tests/android-project-integrity.test.ts` fails the build otherwise, which is
 * the point: when a phase adds an endpoint, every double is updated in the
 * same change rather than silently drifting.
 *
 * Only the two endpoints these tests exercise (`requestPasswordReset`,
 * `updatePassword`) record and answer; everything else throws, so a test that
 * starts depending on another endpoint by accident fails loudly instead of
 * passing on invented data.
 */
class FakeAuthApi : MaharaniApi {

  /** Every password-reset request the code under test made, in order. */
  val passwordResetRequests: MutableList<PasswordResetRequestDto> = mutableListOf()

  /** Every password-update request the code under test made, in order. */
  val passwordUpdateRequests: MutableList<PasswordUpdateRequestDto> = mutableListOf()

  var nextResetResult: () -> ApiEnvelope<AckDto> = { ApiEnvelope(AckDto(ok = true)) }
  var nextUpdateResult: () -> ApiEnvelope<AckDto> = { ApiEnvelope(AckDto(ok = true)) }

  /** When set, reset requests suspend until completed — for double-submit tests. */
  var resetGate: CompletableDeferred<ApiEnvelope<AckDto>>? = null

  /** When set, update requests suspend until completed — for double-submit tests. */
  var updateGate: CompletableDeferred<ApiEnvelope<AckDto>>? = null

  override suspend fun requestPasswordReset(body: PasswordResetRequestDto): ApiEnvelope<AckDto> {
    passwordResetRequests.add(body)
    val gate = resetGate
    return gate?.await() ?: nextResetResult()
  }

  override suspend fun updatePassword(body: PasswordUpdateRequestDto): ApiEnvelope<AckDto> {
    passwordUpdateRequests.add(body)
    val gate = updateGate
    return gate?.await() ?: nextUpdateResult()
  }

  private fun unexpected(name: String): Nothing =
    throw AssertionError("Unexpected API call in an auth-feature test: $name")

  override suspend fun health(): ApiEnvelope<HealthDto> = unexpected("health")

  override suspend fun session(): ApiEnvelope<SessionDto> = unexpected("session")

  override suspend fun login(body: LoginRequestDto): ApiEnvelope<AuthSessionDto> =
    unexpected("login")

  override suspend fun refresh(body: RefreshRequestDto): ApiEnvelope<RefreshSessionDto> =
    unexpected("refresh")

  override suspend fun logout(): ApiEnvelope<AckDto> = unexpected("logout")

  override suspend fun areas(): ApiEnvelope<AreasDto> = unexpected("areas")

  override suspend fun registerRetailer(
    body: RegisterRetailerRequestDto,
  ): ApiEnvelope<RegisterRetailerResponseDto> = unexpected("registerRetailer")

  override suspend fun catalogProducts(
    search: String?,
    categoryId: String?,
    brandId: String?,
    sort: String?,
    inStock: String?,
    favoritesOnly: String?,
    cursor: String?,
  ): ApiEnvelope<List<CatalogProductDto>> = unexpected("catalogProducts")

  override suspend fun catalogProduct(id: String): ApiEnvelope<ProductDetailDto> =
    unexpected("catalogProduct")

  override suspend fun catalogCategories(): ApiEnvelope<CatalogCategoriesDto> =
    unexpected("catalogCategories")

  override suspend fun catalogBrands(): ApiEnvelope<CatalogBrandsDto> =
    unexpected("catalogBrands")

  override suspend fun retailerHome(): ApiEnvelope<RetailerHomeDto> = unexpected("retailerHome")

  override suspend fun mobileCart(): ApiEnvelope<MobileCartDto> = unexpected("mobileCart")

  override suspend fun addCartLine(body: CartLineRequestDto): ApiEnvelope<MobileCartDto> =
    unexpected("addCartLine")

  override suspend fun updateCartLine(
    lineId: String,
    body: CartQuantityRequestDto,
  ): ApiEnvelope<MobileCartDto> = unexpected("updateCartLine")

  override suspend fun removeCartLine(lineId: String): ApiEnvelope<MobileCartDto> =
    unexpected("removeCartLine")

  override suspend fun applyCartCoupon(body: CouponRequestDto): ApiEnvelope<CouponResultDto> =
    unexpected("applyCartCoupon")

  override suspend fun removeCartCoupon(): ApiEnvelope<CouponRemovedDto> =
    unexpected("removeCartCoupon")

  override suspend fun mobileAddresses(): ApiEnvelope<MobileAddressesDto> =
    unexpected("mobileAddresses")

  override suspend fun createAddress(body: AddressPayloadDto): ApiEnvelope<MobileAddressMutationDto> =
    unexpected("createAddress")

  override suspend fun updateAddress(
    addressId: String,
    body: AddressPayloadDto,
  ): ApiEnvelope<MobileAddressMutationDto> = unexpected("updateAddress")

  override suspend fun deleteAddress(addressId: String): ApiEnvelope<MobileAddressesDto> =
    unexpected("deleteAddress")

  override suspend fun setDefaultAddress(addressId: String): ApiEnvelope<MobileAddressMutationDto> =
    unexpected("setDefaultAddress")

  override suspend fun checkoutQuote(body: CheckoutQuoteRequestDto): ApiEnvelope<CheckoutQuoteDto> =
    unexpected("checkoutQuote")

  override suspend fun placeOrder(
    requestKey: String,
    body: PlaceOrderRequestDto,
  ): ApiEnvelope<PlaceOrderResponseDto> = unexpected("placeOrder")

  override suspend fun orderHistory(cursor: String?): ApiEnvelope<List<MobileOrderDto>> =
    unexpected("orderHistory")

  override suspend fun orderDetail(orderId: String): ApiEnvelope<MobileOrderDto> =
    unexpected("orderDetail")

  override suspend fun orderInvoice(orderId: String): ApiEnvelope<MobileInvoiceDto> =
    unexpected("orderInvoice")

  override suspend fun orderDelivery(orderId: String): ApiEnvelope<MobileDeliveryDto> =
    unexpected("orderDelivery")

  override suspend fun recoverOrderRequest(requestKey: String): ApiEnvelope<MobileOrderDto> =
    unexpected("recoverOrderRequest")

  override suspend fun notifications(
    cursor: String?,
    unreadOnly: String?,
  ): ApiEnvelope<List<MobileNotificationDto>> = unexpected("notifications")

  override suspend fun markNotificationsRead(
    body: MarkReadRequestDto,
  ): ApiEnvelope<MarkReadResponseDto> = unexpected("markNotificationsRead")

  override suspend fun walletSummary(): ApiEnvelope<MobileWalletSummaryDto> =
    unexpected("walletSummary")

  override suspend fun walletLedger(
    cursor: String?,
  ): ApiEnvelope<List<MobileWalletLedgerEntryDto>> = unexpected("walletLedger")

  override suspend fun quickOrder(q: String): ApiEnvelope<MobileQuickOrderDto> =
    unexpected("quickOrder")

  override suspend fun matchBulkLines(
    body: MobileBulkMatchRequestDto,
  ): ApiEnvelope<MobileBulkMatchDto> = unexpected("matchBulkLines")

  override suspend fun favorites(): ApiEnvelope<MobileFavoritesDto> = unexpected("favorites")

  override suspend fun toggleFavorite(
    body: FavoriteToggleRequestDto,
  ): ApiEnvelope<FavoriteToggleResponseDto> = unexpected("toggleFavorite")

  override suspend fun coupons(): ApiEnvelope<MobileCouponsDto> = unexpected("coupons")

  // ---------------------------------------------------------------------------
  // Native retailer upgrade endpoints
  // ---------------------------------------------------------------------------
  //
  // The auth-feature tests never call these, so each one fails loudly rather
  // than answering with invented data. They are declared because MaharaniApi
  // added them and this double claims to implement it — the static guard in
  // tests/android-project-integrity.test.ts asserts the whole interface is
  // covered, which is what keeps a new endpoint from silently drifting away
  // from the doubles.

  override suspend fun changePassword(body: PasswordChangeRequestDto): ApiEnvelope<AckDto> =
    unexpected("changePassword")

  override suspend fun revokeAllSessions(): ApiEnvelope<AckDto> = unexpected("revokeAllSessions")

  override suspend fun retailerProfile(): ApiEnvelope<MobileRetailerProfileDto> =
    unexpected("retailerProfile")

  override suspend fun updateRetailerProfile(body: MobileProfilePatchDto): ApiEnvelope<AckDto> =
    unexpected("updateRetailerProfile")

  override suspend fun notificationPreferences(): ApiEnvelope<MobileNotificationPreferencesDto> =
    unexpected("notificationPreferences")

  override suspend fun updateNotificationPreferences(
    body: MobileNotificationPreferencesDto,
  ): ApiEnvelope<AckDto> = unexpected("updateNotificationPreferences")

  override suspend fun schemes(): ApiEnvelope<MobileSchemesDto> = unexpected("schemes")

  override suspend fun helpDetails(): ApiEnvelope<MobileHelpDto> = unexpected("helpDetails")

  override suspend fun accountRequests(): ApiEnvelope<MobileAccountRequestsDto> =
    unexpected("accountRequests")

  override suspend fun createAccountRequest(
    body: MobileAccountRequestCreateDto,
  ): ApiEnvelope<MobileAccountRequestDto> = unexpected("createAccountRequest")

  override suspend fun purchaseReports(): ApiEnvelope<MobileReportsDto> =
    unexpected("purchaseReports")

  /** Streaming CSV, so it does not answer with the JSON envelope. */
  override suspend fun reportStatementCsv(type: String, from: String?, to: String?): ResponseBody =
    unexpected("reportStatementCsv")

  override suspend fun supportTickets(
    cursor: String?,
    status: String?,
  ): ApiEnvelope<List<MobileSupportTicketDto>> = unexpected("supportTickets")

  override suspend fun createSupportTicket(
    body: MobileSupportCreateRequestDto,
  ): ApiEnvelope<MobileSupportCreateResponseDto> = unexpected("createSupportTicket")

  override suspend fun supportTicket(ticketId: String): ApiEnvelope<MobileSupportTicketDetailDto> =
    unexpected("supportTicket")

  override suspend fun replyToSupportTicket(
    ticketId: String,
    body: MobileSupportReplyRequestDto,
  ): ApiEnvelope<MobileSupportMessageDto> = unexpected("replyToSupportTicket")

  override suspend fun savedCarts(): ApiEnvelope<MobileSavedCartsDto> = unexpected("savedCarts")

  override suspend fun saveCurrentCart(
    body: MobileSavedCartCreateRequestDto,
  ): ApiEnvelope<MobileSavedCartMutationDto> = unexpected("saveCurrentCart")

  override suspend fun renameSavedCart(
    savedCartId: String,
    body: MobileSavedCartRenameRequestDto,
  ): ApiEnvelope<AckDto> = unexpected("renameSavedCart")

  override suspend fun deleteSavedCart(savedCartId: String): ApiEnvelope<AckDto> =
    unexpected("deleteSavedCart")

  override suspend fun restoreSavedCart(savedCartId: String): ApiEnvelope<MobileSavedCartRestoreDto> =
    unexpected("restoreSavedCart")

  override suspend fun saveCartItemForLater(
    body: MobileSaveForLaterRequestDto,
  ): ApiEnvelope<MobileSavedCartMutationDto> = unexpected("saveCartItemForLater")

  override suspend fun deleteSavedCartItem(itemId: String): ApiEnvelope<AckDto> =
    unexpected("deleteSavedCartItem")

  override suspend fun restoreSavedCartItem(itemId: String): ApiEnvelope<MobileSavedCartRestoreDto> =
    unexpected("restoreSavedCartItem")

  override suspend fun cancelOrder(
    orderId: String,
    body: MobileOrderActionRequestDto,
  ): ApiEnvelope<AckDto> = unexpected("cancelOrder")

  override suspend fun requestOrderReturn(
    orderId: String,
    body: MobileOrderActionRequestDto,
  ): ApiEnvelope<MobileReturnRequestResponseDto> = unexpected("requestOrderReturn")
}
