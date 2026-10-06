package com.maharanitraders.feature.engagement

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.MobileAccountRequestCreateDto
import com.maharanitraders.core.network.dto.MobileAccountRequestDto
import com.maharanitraders.core.network.dto.MobileHelpDto
import com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto
import com.maharanitraders.core.network.dto.MobileProfilePatchDto
import com.maharanitraders.core.network.dto.MobileRetailerProfileDto
import com.maharanitraders.core.network.dto.MobileReportsDto
import com.maharanitraders.core.network.dto.MobileSchemeDto
import com.maharanitraders.core.network.dto.MobileSupportCreateRequestDto
import com.maharanitraders.core.network.dto.MobileSupportMessageDto
import com.maharanitraders.core.network.dto.MobileSupportReplyRequestDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDetailDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDto
import com.maharanitraders.core.network.dto.MobileSupportTicketsDto
import javax.inject.Inject
import javax.inject.Singleton

interface RetailerUpgradeRepository {
  suspend fun loadProfile(): AppResult<RetailerProfile>
  suspend fun updateShopProfile(shopName: String, address: String): AppResult<Unit>
  suspend fun updateContactProfile(fullName: String, phone: String): AppResult<Unit>
  suspend fun loadNotificationPreferences(): AppResult<MobileNotificationPreferencesDto>
  suspend fun saveNotificationPreferences(preferences: MobileNotificationPreferencesDto): AppResult<Unit>
  suspend fun loadSchemes(): AppResult<List<MobileSchemeDto>>
  suspend fun loadPurchaseReports(): AppResult<MobileReportsDto>
  suspend fun loadHelpDetails(): AppResult<MobileHelpDto>
  suspend fun loadSupportTickets(cursor: String?, status: String?): AppResult<SupportTicketPage>
  suspend fun loadSupportOrders(): AppResult<List<SupportOrderOption>>
  suspend fun createSupportTicket(
    subject: String,
    topic: String,
    priority: String,
    orderId: String?,
    description: String,
  ): AppResult<String>
  suspend fun loadSupportTicket(ticketId: String): AppResult<MobileSupportTicketDetailDto>
  suspend fun replyToSupportTicket(ticketId: String, body: String): AppResult<MobileSupportMessageDto>
  suspend fun loadAccountRequests(): AppResult<List<MobileAccountRequestDto>>
  suspend fun createAccountRequest(requestType: String, note: String): AppResult<MobileAccountRequestDto>
  suspend fun exportStatement(type: String, from: String?, to: String?): AppResult<String>
}

data class RetailerProfile(
  val shopName: String,
  val address: String,
  val gstin: String?,
  val status: String,
  val fullName: String,
  val phone: String,
)

data class SupportTicketPage(
  val tickets: List<MobileSupportTicketDto>,
  val nextCursor: String?,
  val hasMore: Boolean,
)

data class SupportOrderOption(
  val id: String,
  val orderNumber: String,
)

@Singleton
class NetworkRetailerUpgradeRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : RetailerUpgradeRepository {
  override suspend fun loadProfile(): AppResult<RetailerProfile> =
    executor.executeEnvelope { api.retailerProfile() }.map(MobileRetailerProfileDto::toDomain)

  override suspend fun updateShopProfile(shopName: String, address: String): AppResult<Unit> =
    executor.executeEnvelope {
      api.updateRetailerProfile(MobileProfilePatchDto(section = "shop", shopName = shopName, address = address))
    }.map { Unit }

  override suspend fun updateContactProfile(fullName: String, phone: String): AppResult<Unit> =
    executor.executeEnvelope {
      api.updateRetailerProfile(MobileProfilePatchDto(section = "contact", fullName = fullName, phone = phone))
    }.map { Unit }

  override suspend fun loadNotificationPreferences(): AppResult<MobileNotificationPreferencesDto> =
    executor.executeEnvelope { api.notificationPreferences() }

  override suspend fun saveNotificationPreferences(preferences: MobileNotificationPreferencesDto): AppResult<Unit> =
    executor.executeEnvelope { api.updateNotificationPreferences(preferences) }.map { Unit }

  override suspend fun loadSchemes(): AppResult<List<MobileSchemeDto>> =
    executor.executeEnvelope { api.schemes() }.map { it.schemes }

  override suspend fun loadPurchaseReports(): AppResult<MobileReportsDto> =
    executor.executeEnvelope { api.purchaseReports() }

  override suspend fun loadHelpDetails(): AppResult<MobileHelpDto> =
    executor.executeEnvelope { api.helpDetails() }

  override suspend fun loadSupportTickets(cursor: String?, status: String?): AppResult<SupportTicketPage> =
    executor.execute { api.supportTickets(cursor = cursor, status = status) }.map { response ->
      SupportTicketPage(
        tickets = response.data,
        nextCursor = response.page?.nextCursor,
        hasMore = response.page?.hasMore == true,
      )
    }

  override suspend fun loadSupportOrders(): AppResult<List<SupportOrderOption>> =
    executor.executeEnvelope { api.orderHistory() }.map { orders ->
      orders.take(50).map { order -> SupportOrderOption(order.id, order.orderNumber) }
    }

  override suspend fun createSupportTicket(
    subject: String,
    topic: String,
    priority: String,
    orderId: String?,
    description: String,
  ): AppResult<String> = executor.executeEnvelope {
    api.createSupportTicket(
      MobileSupportCreateRequestDto(
        subject = subject,
        topic = topic,
        priority = priority,
        orderId = orderId,
        description = description,
      ),
    )
  }.map { it.ticketNumber }

  override suspend fun loadSupportTicket(ticketId: String): AppResult<MobileSupportTicketDetailDto> =
    executor.executeEnvelope { api.supportTicket(ticketId) }

  override suspend fun replyToSupportTicket(ticketId: String, body: String): AppResult<MobileSupportMessageDto> =
    executor.executeEnvelope { api.replyToSupportTicket(ticketId, MobileSupportReplyRequestDto(body)) }

  override suspend fun loadAccountRequests(): AppResult<List<MobileAccountRequestDto>> =
    executor.executeEnvelope { api.accountRequests() }.map { it.requests }

  override suspend fun createAccountRequest(requestType: String, note: String): AppResult<MobileAccountRequestDto> =
    executor.executeEnvelope {
      api.createAccountRequest(MobileAccountRequestCreateDto(requestType = requestType, note = note))
    }

  override suspend fun exportStatement(type: String, from: String?, to: String?): AppResult<String> =
    executor.execute { api.reportStatementCsv(type = type, from = from, to = to).use { it.string() } }
}

private fun MobileRetailerProfileDto.toDomain() = RetailerProfile(
  shopName = shopName.orEmpty(),
  address = address.orEmpty(),
  gstin = gstin,
  status = status,
  fullName = fullName.orEmpty(),
  phone = phone.orEmpty(),
)
