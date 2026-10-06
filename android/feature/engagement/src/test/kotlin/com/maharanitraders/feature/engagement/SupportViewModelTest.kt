package com.maharanitraders.feature.engagement

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.network.dto.MobileAccountRequestDto
import com.maharanitraders.core.network.dto.MobileHelpDto
import com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto
import com.maharanitraders.core.network.dto.MobileReportsDto
import com.maharanitraders.core.network.dto.MobileSchemeDto
import com.maharanitraders.core.network.dto.MobileSupportMessageDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDetailDto
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

@OptIn(ExperimentalCoroutinesApi::class)
class SupportViewModelTest {
  private val testDispatcher = StandardTestDispatcher()
  private lateinit var repository: FakeRetailerUpgradeRepository

  @Before
  fun setUp() {
    Dispatchers.setMain(testDispatcher)
    repository = FakeRetailerUpgradeRepository()
  }

  @After
  fun tearDown() {
    Dispatchers.resetMain()
  }

  @Test
  fun `creating a support ticket includes the selected retailer order`() = runTest(testDispatcher) {
    val viewModel = SupportViewModel(repository)
    advanceUntilIdle() // Complete the initial ticket-list request.

    viewModel.openCreate()
    advanceUntilIdle() // Load recent orders before selecting one.
    viewModel.onSubject("Damaged order delivery")
    viewModel.onDescription("Several items in this order arrived damaged and need review.")
    viewModel.onSelectedOrder("owned-order-1")
    viewModel.createTicket()
    advanceUntilIdle()

    assertThat(repository.createdOrderId).isEqualTo("owned-order-1")
    assertThat(viewModel.state.value.message).isEqualTo("Ticket MT-1001 was submitted.")
  }
}

private class FakeRetailerUpgradeRepository : RetailerUpgradeRepository {
  var createdOrderId: String? = null

  override suspend fun loadProfile(): AppResult<RetailerProfile> = unused()
  override suspend fun updateShopProfile(shopName: String, address: String): AppResult<Unit> = unused()
  override suspend fun updateContactProfile(fullName: String, phone: String): AppResult<Unit> = unused()
  override suspend fun loadNotificationPreferences(): AppResult<MobileNotificationPreferencesDto> = unused()
  override suspend fun saveNotificationPreferences(preferences: MobileNotificationPreferencesDto): AppResult<Unit> = unused()
  override suspend fun loadSchemes(): AppResult<List<MobileSchemeDto>> = unused()
  override suspend fun loadPurchaseReports(): AppResult<MobileReportsDto> = unused()
  override suspend fun loadHelpDetails(): AppResult<MobileHelpDto> = unused()

  override suspend fun loadSupportTickets(cursor: String?, status: String?): AppResult<SupportTicketPage> =
    AppResult.Success(SupportTicketPage(emptyList(), nextCursor = null, hasMore = false))

  override suspend fun loadSupportOrders(): AppResult<List<SupportOrderOption>> =
    AppResult.Success(listOf(SupportOrderOption(id = "owned-order-1", orderNumber = "MT-ORDER-1")))

  override suspend fun createSupportTicket(
    subject: String,
    topic: String,
    priority: String,
    orderId: String?,
    description: String,
  ): AppResult<String> {
    createdOrderId = orderId
    return AppResult.Success("MT-1001")
  }

  override suspend fun loadSupportTicket(ticketId: String): AppResult<MobileSupportTicketDetailDto> = unused()
  override suspend fun replyToSupportTicket(ticketId: String, body: String): AppResult<MobileSupportMessageDto> = unused()
  override suspend fun loadAccountRequests(): AppResult<List<MobileAccountRequestDto>> = unused()
  override suspend fun createAccountRequest(requestType: String, note: String): AppResult<MobileAccountRequestDto> = unused()
  override suspend fun exportStatement(type: String, from: String?, to: String?): AppResult<String> = unused()

  private fun <T> unused(): AppResult<T> = AppResult.Failure(AppError.Unexpected("unused-test-method"))
}
