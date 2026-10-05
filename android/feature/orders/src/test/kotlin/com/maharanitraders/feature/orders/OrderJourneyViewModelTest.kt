package com.maharanitraders.feature.orders

import androidx.lifecycle.SavedStateHandle
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The order-journey view models: one order's detail record, its invoice and its
 * delivery note.
 *
 * These pin the rules that would otherwise be discovered in production:
 *  - a reorder replays the order's PIECE counts (`quantity_pieces` when the
 *    server stored them) and skips a line whose pack is gone, never guessing;
 *  - a failed reorder re-reads the server badge count instead of claiming the
 *    cart is untouched;
 *  - a missing order/invoice/delivery is an error state, never an empty screen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OrderJourneyViewModelTest {
  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() {
    Dispatchers.setMain(dispatcher)
  }

  @After
  fun tearDown() {
    Dispatchers.resetMain()
  }

  private fun detailViewModel(repository: FakeJourneyRepository): OrderDetailViewModel =
    OrderDetailViewModel(
      repository = repository,
      cartCountStore = CartCountStore(repository),
      savedStateHandle = SavedStateHandle(mapOf(OrderDetailViewModel.ARG_ORDER_ID to ORDER_ID)),
    )

  @Test
  fun `detail loads the server record and exposes its status history`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository()
    val viewModel = detailViewModel(repository)
    advanceUntilIdle()

    assertEquals(listOf(ORDER_ID), repository.detailCalls)
    val order = viewModel.state.value.order
    assertEquals("MT-1", order?.orderNumber)
    assertEquals(listOf("pending", "delivered"), order?.statusHistory?.map { it.status })
    assertEquals(1500L, order?.coinsSpentPaise)
    assertFalse(viewModel.state.value.loading)
    assertTrue(viewModel.state.value.canReorder)
  }

  @Test
  fun `a foreign or missing order is an error, and a blank id never calls the server`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository().apply {
      detailResults += AppResult.Failure(AppError.Api(ApiErrorCode.NOT_FOUND, "This order could not be found."))
    }
    val viewModel = detailViewModel(repository)
    advanceUntilIdle()
    assertEquals("This order could not be found.", viewModel.state.value.error)
    assertNull(viewModel.state.value.order)

    val blankRepository = FakeJourneyRepository()
    val blank = OrderDetailViewModel(
      repository = blankRepository,
      cartCountStore = CartCountStore(blankRepository),
      savedStateHandle = SavedStateHandle(mapOf(OrderDetailViewModel.ARG_ORDER_ID to "")),
    )
    advanceUntilIdle()
    assertEquals(emptyList<String>(), blankRepository.detailCalls)
    assertEquals(ApiErrorCode.NOT_FOUND, blank.state.value.errorCode)
  }

  @Test
  fun `reorder replays stored piece counts and skips a line whose pack is gone`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository()
    val viewModel = detailViewModel(repository)
    advanceUntilIdle()

    viewModel.reorder()
    advanceUntilIdle()

    // 24 pieces (stored quantity_pieces) for the pack that still exists; the
    // packless line is skipped rather than guessed at.
    assertEquals(
      listOf(CartLineIntent(packId = "pack-1", quantity = 24)),
      repository.reorderCalls.single(),
    )
    assertEquals(1, viewModel.state.value.reorderAddedCount)
    assertTrue(viewModel.state.value.reorderCompleted)
  }

  @Test
  fun `a reorder with nothing purchaseable says so and issues no call`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository()
    repository.detail = repository.detail.copy(
      items = repository.detail.items.map { item -> item.copy(packId = null) },
    )
    val viewModel = detailViewModel(repository)
    advanceUntilIdle()

    viewModel.reorder()
    advanceUntilIdle()

    assertEquals(emptyList<List<CartLineIntent>>(), repository.reorderCalls)
    assertFalse(viewModel.state.value.reorderCompleted)
    assertEquals("This order has no purchaseable lines to reorder.", viewModel.state.value.reorderError)
  }

  @Test
  fun `a failed reorder keeps the server cart truth and does not report success`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository().apply {
      reorderResults += AppResult.Failure(
        AppError.Api(ApiErrorCode.INSUFFICIENT_STOCK, "This pack is out of stock right now."),
      )
    }
    val viewModel = detailViewModel(repository)
    advanceUntilIdle()

    viewModel.reorder()
    advanceUntilIdle()

    assertEquals("This pack is out of stock right now.", viewModel.state.value.reorderError)
    assertFalse(viewModel.state.value.reorderCompleted)
    // The badge is re-read from the server: earlier lines in the same replay may
    // already have been accepted, so the app must not assume the cart is empty.
    assertEquals(1, repository.loadCartCalls)
    assertEquals(3, repository.cartAfterFailure.lineCount)
  }

  @Test
  fun `a successful reorder records the server cart counts in the badge store`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository().apply {
      reorderResults += AppResult.Success(
        ReorderOutcome(
          requestedCount = 1,
          addedCount = 1,
          cart = CartSnapshot(emptyList(), couponCode = null, couponUnavailable = false, lineCount = 4, itemCount = 9),
        ),
      )
    }
    val store = CartCountStore(repository)
    val viewModel = OrderDetailViewModel(
      repository = repository,
      cartCountStore = store,
      savedStateHandle = SavedStateHandle(mapOf(OrderDetailViewModel.ARG_ORDER_ID to ORDER_ID)),
    )
    advanceUntilIdle()

    viewModel.reorder()
    advanceUntilIdle()

    assertEquals(4, store.state.value.lineCount)
    assertEquals(9, store.state.value.itemCount)
  }

  @Test
  fun `invoice state carries the server figures, including an unsplit tax mode`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository()
    val viewModel = InvoiceViewModel(repository, SavedStateHandle(mapOf(OrderDetailViewModel.ARG_ORDER_ID to ORDER_ID)))
    advanceUntilIdle()

    val invoice = viewModel.state.value.invoice
    assertEquals("unsplit", invoice?.taxMode)
    assertFalse(invoice?.isIntraState == true)
    assertEquals(0L, invoice?.totals?.cgstPaise)
    assertEquals(9000L, invoice?.totals?.gstTotalPaise)
    assertFalse(viewModel.state.value.loading)
  }

  @Test
  fun `a failed invoice load is an error state with the server's message`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository().apply {
      invoiceResults += AppResult.Failure(AppError.Api(ApiErrorCode.NOT_FOUND, "This invoice could not be found."))
    }
    val viewModel = InvoiceViewModel(repository, SavedStateHandle(mapOf(OrderDetailViewModel.ARG_ORDER_ID to ORDER_ID)))
    advanceUntilIdle()

    assertEquals("This invoice could not be found.", viewModel.state.value.error)
    assertNull(viewModel.state.value.invoice)
  }

  @Test
  fun `delivery state carries the delivered facts and the shortfall flag`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository()
    val viewModel = DeliveryViewModel(repository, SavedStateHandle(mapOf(OrderDetailViewModel.ARG_ORDER_ID to ORDER_ID)))
    advanceUntilIdle()

    val delivery = viewModel.state.value.delivery
    assertEquals("delivered", delivery?.status)
    assertTrue(delivery?.otpVerified == true)
    assertEquals(2, delivery?.items?.first()?.quantityMissing)
    assertTrue(delivery?.hasShortfall == true)
    // The return window is the server's own decision and already closed here.
    assertEquals(false, delivery?.returnWindowOpen)
  }

  @Test
  fun `delivery loads with the order id from navigation and never invents a record`() = runTest(dispatcher) {
    val repository = FakeJourneyRepository().apply {
      deliveryResults += AppResult.Failure(AppError.Network("offline"))
    }
    val viewModel = DeliveryViewModel(repository, SavedStateHandle(mapOf(OrderDetailViewModel.ARG_ORDER_ID to ORDER_ID)))
    advanceUntilIdle()

    assertEquals(listOf(ORDER_ID), repository.deliveryCalls)
    assertNull(viewModel.state.value.delivery)
    assertTrue(viewModel.state.value.offline)
  }

  /**
   * A repository double that answers the four journey calls and throws for the
   * rest, so a test that accidentally reaches another path fails loudly.
   */
  private class FakeJourneyRepository : CommerceRepository {
    val detailCalls = mutableListOf<String>()
    val deliveryCalls = mutableListOf<String>()
    val reorderCalls = mutableListOf<List<CartLineIntent>>()
    val detailResults = mutableListOf<AppResult<RetailerOrder>>()
    val invoiceResults = mutableListOf<AppResult<OrderInvoice>>()
    val deliveryResults = mutableListOf<AppResult<OrderDelivery>>()
    val reorderResults = mutableListOf<AppResult<ReorderOutcome>>()
    var loadCartCalls = 0
    var cartAfterFailure = CartSnapshot(emptyList(), couponCode = null, couponUnavailable = false, lineCount = 3, itemCount = 7)

    var detail: RetailerOrder = order()
    var invoice: OrderInvoice = invoice()
    var delivery: OrderDelivery = delivery()

    override suspend fun orderDetail(orderId: String): AppResult<RetailerOrder> {
      detailCalls += orderId
      return detailResults.removeFirstOrNull() ?: AppResult.Success(detail)
    }

    override suspend fun orderInvoice(orderId: String): AppResult<OrderInvoice> =
      invoiceResults.removeFirstOrNull() ?: AppResult.Success(invoice)

    override suspend fun orderDelivery(orderId: String): AppResult<OrderDelivery> {
      deliveryCalls += orderId
      return deliveryResults.removeFirstOrNull() ?: AppResult.Success(delivery)
    }

    override suspend fun reorderLines(intents: List<CartLineIntent>): AppResult<ReorderOutcome> {
      reorderCalls += intents
      return reorderResults.removeFirstOrNull()
        ?: AppResult.Success(ReorderOutcome(intents.size, intents.size, null))
    }

    override suspend fun loadCart(): AppResult<CartSnapshot> {
      loadCartCalls += 1
      return AppResult.Success(cartAfterFailure)
    }

    override suspend fun addCartLine(packId: String, quantity: Int): AppResult<CartSnapshot> =
      throw UnsupportedOperationException("addCartLine is not part of the order journey")

    override suspend fun updateCartLine(lineId: String, quantity: Int): AppResult<CartSnapshot> =
      throw UnsupportedOperationException("updateCartLine is not part of the order journey")

    override suspend fun removeCartLine(lineId: String): AppResult<CartSnapshot> =
      throw UnsupportedOperationException("removeCartLine is not part of the order journey")

    override suspend fun loadAddresses(): AppResult<List<DeliveryAddress>> =
      throw UnsupportedOperationException("loadAddresses is not part of the order journey")

    override suspend fun createAddress(draft: AddressDraft): AppResult<List<DeliveryAddress>> =
      throw UnsupportedOperationException("createAddress is not part of the order journey")

    override suspend fun updateAddress(addressId: String, draft: AddressDraft): AppResult<List<DeliveryAddress>> =
      throw UnsupportedOperationException("updateAddress is not part of the order journey")

    override suspend fun deleteAddress(addressId: String): AppResult<List<DeliveryAddress>> =
      throw UnsupportedOperationException("deleteAddress is not part of the order journey")

    override suspend fun setDefaultAddress(addressId: String): AppResult<List<DeliveryAddress>> =
      throw UnsupportedOperationException("setDefaultAddress is not part of the order journey")

    override suspend fun applyCoupon(code: String): AppResult<CouponApplication> =
      throw UnsupportedOperationException("applyCoupon is not part of the order journey")

    override suspend fun removeCoupon(): AppResult<Unit> =
      throw UnsupportedOperationException("removeCoupon is not part of the order journey")

    override suspend fun quote(lines: List<CartLineIntent>, addressId: String?): AppResult<CheckoutQuote> =
      throw UnsupportedOperationException("quote is not part of the order journey")

    override suspend fun placeOrder(
      requestKey: String,
      lines: List<CartLineIntent>,
      addressId: String?,
      notes: String,
    ): AppResult<OrderConfirmation> =
      throw UnsupportedOperationException("placeOrder is not part of the order journey")

    override suspend fun recoverOrder(requestKey: String): AppResult<RetailerOrder> =
      throw UnsupportedOperationException("recoverOrder is not part of the order journey")

    override suspend fun orderHistory(cursor: String?): AppResult<OrderHistoryPage> =
      throw UnsupportedOperationException("orderHistory is not part of the order journey")
  }

  private companion object {
    const val ORDER_ID = "0f2a6a3e-6d2f-4a1f-9a5f-2b7c1d4e8f90"

    fun order(): RetailerOrder = RetailerOrder(
      id = ORDER_ID,
      orderNumber = "MT-1",
      status = "delivered",
      subtotalPaise = 50_000,
      gstTotalPaise = 9_000,
      discountTotalPaise = 0,
      grandTotalPaise = 50_000,
      placedAt = "2026-10-01T10:00:00.000Z",
      updatedAt = "2026-10-02T10:00:00.000Z",
      notes = null,
      shippingAddressLine = "Shop 1, Main Road",
      items = listOf(
        OrderItem(
          id = "item-1",
          productId = "product-1",
          packId = "pack-1",
          productName = "Soap",
          packName = "20 pc case",
          quantity = 20,
          quantityUnit = "pieces",
          quantityPieces = 24,
          unitsPerCase = 20,
          unitPricePaise = 1_000,
          gstPercent = 18.0,
          lineTotalPaise = 24_000,
        ),
        OrderItem(
          id = "item-2",
          productId = "product-2",
          packId = null,
          productName = "Legacy pack",
          packName = null,
          quantity = 3,
          quantityUnit = "pieces",
          quantityPieces = null,
          unitsPerCase = null,
          unitPricePaise = 2_000,
          gstPercent = 18.0,
          lineTotalPaise = 6_000,
        ),
      ),
      coinsUsedPaise = null,
      balanceAfterCoinsPaise = null,
      statusHistory = listOf(
        OrderStatusEntry(id = "h1", status = "pending", note = null, createdAt = "2026-10-01T10:00:00.000Z"),
        OrderStatusEntry(id = "h2", status = "delivered", note = "Handed over", createdAt = "2026-10-02T10:00:00.000Z"),
      ),
      coinsSpentPaise = 1_500,
      coinsRefundedPaise = 0,
      coinsRefunded = false,
    )

    fun invoice(): OrderInvoice = OrderInvoice(
      orderId = ORDER_ID,
      orderNumber = "MT-1",
      status = "delivered",
      placedAt = "2026-10-01T10:00:00.000Z",
      biller = InvoiceParty(name = "Maharani Traders", gstin = null, address = null, phone = null),
      billedTo = InvoiceBilledTo(shopName = "Shop 1", address = null, areaName = null, gstin = null),
      taxMode = "unsplit",
      lines = listOf(
        InvoiceLine(
          key = "pack-1",
          displayName = "Soap",
          packName = "20 pc case",
          hsn = null,
          quantityLabel = "24 pcs",
          unitPrices = listOf(InvoiceUnitPrice(unitPricePaise = 1_000, unit = "pc")),
          gstPercent = 18.0,
          lineTotalPaise = 24_000,
          taxPaise = 3_661,
          cgstPaise = 0,
          sgstPaise = 0,
          igstPaise = 0,
        ),
      ),
      totals = InvoiceTotals(
        subtotalPaise = 50_000,
        gstTotalPaise = 9_000,
        cgstPaise = 0,
        sgstPaise = 0,
        igstPaise = 0,
        discountPaise = 0,
        grandTotalPaise = 50_000,
      ),
    )

    fun delivery(): OrderDelivery = OrderDelivery(
      orderId = ORDER_ID,
      orderNumber = "MT-1",
      orderStatus = "delivered",
      grandTotalPaise = 50_000,
      placedAt = "2026-10-01T10:00:00.000Z",
      shippingAddressLine = "Shop 1, Main Road",
      status = "delivered",
      assignedName = "Delivery person",
      dispatchedAt = "2026-10-02T06:00:00.000Z",
      inProgressAt = "2026-10-02T08:00:00.000Z",
      deliveredAt = "2026-10-02T10:00:00.000Z",
      receiverName = "Shop owner",
      otpVerified = true,
      deliveryNotes = null,
      failureReason = null,
      returnWindowDays = 7,
      returnDeadline = "2026-10-09",
      returnWindowOpen = false,
      proof = DeliveryProof(
        signatureCaptured = true,
        photoCaptured = false,
        signatureUrl = "https://example.test/signature.png",
        photoUrl = null,
      ),
      items = listOf(
        DeliveryItem(
          id = "di-1",
          productName = "Soap",
          packName = "20 pc case",
          quantityOrdered = 24,
          quantityDelivered = 22,
          quantityMissing = 2,
          quantityDamaged = 0,
          lineTotalPaise = 24_000,
        ),
      ),
    )
  }
}
