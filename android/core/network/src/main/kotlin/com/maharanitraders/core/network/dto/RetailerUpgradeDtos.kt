package com.maharanitraders.core.network.dto

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.Serializable

/** Wire models for native retailer account, support, saved-cart and report flows. */

@Serializable
data class MobileRetailerProfileDto(
  val shopName: String? = null,
  val address: String? = null,
  val gstin: String? = null,
  val status: String = "",
  val fullName: String? = null,
  val phone: String? = null,
)

/** One self-service section per write; protected retailer columns have no field here. */
@Serializable
data class MobileProfilePatchDto(
  val section: String,
  val shopName: String? = null,
  val address: String? = null,
  val fullName: String? = null,
  val phone: String? = null,
)

@Serializable
data class MobileNotificationPreferencesDto(
  @EncodeDefault(EncodeDefault.Mode.ALWAYS) val orderUpdates: Boolean = true,
  @EncodeDefault(EncodeDefault.Mode.ALWAYS) val paymentUpdates: Boolean = true,
  @EncodeDefault(EncodeDefault.Mode.ALWAYS) val walletUpdates: Boolean = true,
  @EncodeDefault(EncodeDefault.Mode.ALWAYS) val offerUpdates: Boolean = true,
)

@Serializable
data class MobileSchemesDto(val schemes: List<MobileSchemeDto> = emptyList())

@Serializable
data class MobileSchemeDto(
  val id: String,
  val name: String,
  val description: String? = null,
  val isFestival: Boolean = false,
  val startsAt: String,
  val endsAt: String,
)

@Serializable
data class MobileHelpDto(
  val companyName: String = "Maharani Traders",
  val supportPhone: String? = null,
)

@Serializable
data class MobileReportsDto(
  val week: MobileReportWindowDto,
  val month: MobileReportWindowDto,
  val trend: List<MobileReportTrendDto> = emptyList(),
  val mostPurchased: List<MobileReportProductDto> = emptyList(),
  val coins: MobileReportCoinsDto,
)

@Serializable
data class MobileReportWindowDto(
  val totals: MobileReportTotalsDto,
  val topProducts: List<MobileReportProductDto> = emptyList(),
)

@Serializable
data class MobileReportTotalsDto(
  val orderCount: Int = 0,
  val purchaseValuePaise: Long = 0,
  val gstTotalPaise: Long = 0,
  val discountTotalPaise: Long = 0,
)

@Serializable
data class MobileReportProductDto(
  val productId: String,
  val name: String,
  val brandName: String? = null,
  val totalPieces: Int = 0,
  val totalValuePaise: Long = 0,
  val orderCount: Int = 0,
)

@Serializable
data class MobileReportTrendDto(
  val monthKey: String,
  val label: String,
  val orderCount: Int = 0,
  val purchaseValuePaise: Long = 0,
)

@Serializable
data class MobileReportCoinsDto(
  val coinsFundedPaise: Long = 0,
  val coinsSpentPaise: Long = 0,
  val coinsAvailablePaise: Long = 0,
)

@Serializable
data class MobileSupportTicketsDto(val tickets: List<MobileSupportTicketDto> = emptyList())

@Serializable
data class MobileSupportTicketDto(
  val id: String,
  val ticketNumber: String,
  val subject: String,
  val topic: String,
  val priority: String,
  val status: String,
  val createdAt: String,
  val updatedAt: String,
  val orderNumber: String? = null,
  val orderStatus: String? = null,
)

@Serializable
data class MobileSupportTicketDetailDto(
  val id: String,
  val ticketNumber: String,
  val subject: String,
  val topic: String,
  val priority: String,
  val status: String,
  val orderId: String? = null,
  val orderNumber: String? = null,
  val orderStatus: String? = null,
  val createdAt: String,
  val updatedAt: String,
  val canReply: Boolean = false,
  val messages: List<MobileSupportMessageDto> = emptyList(),
)

@Serializable
data class MobileSupportMessageDto(
  val id: String,
  val authorRole: String,
  val body: String,
  val createdAt: String,
  val isOwn: Boolean = false,
)

@Serializable
data class MobileSupportCreateRequestDto(
  val subject: String,
  val topic: String,
  val priority: String,
  val orderId: String? = null,
  val description: String,
)

@Serializable
data class MobileSupportCreateResponseDto(
  val id: String,
  val ticketNumber: String,
)

@Serializable
data class MobileSupportReplyRequestDto(val body: String)

@Serializable
data class MobileSavedCartsDto(val savedCarts: List<MobileSavedCartDto> = emptyList())

@Serializable
data class MobileSavedCartDto(
  val id: String,
  val name: String,
  val createdAt: String,
  val updatedAt: String,
  val itemCount: Int = 0,
  val items: List<MobileSavedCartItemDto> = emptyList(),
)

@Serializable
data class MobileSavedCartItemDto(
  val id: String,
  val productId: String,
  val packId: String,
  val productName: String? = null,
  val packName: String? = null,
  val quantity: Int,
)

@Serializable
data class MobileSavedCartCreateRequestDto(val name: String)

@Serializable
data class MobileSavedCartRenameRequestDto(val name: String)

@Serializable
data class MobileSavedCartMutationDto(
  val id: String? = null,
  val savedCartId: String? = null,
  val savedCount: Int? = null,
)

@Serializable
data class MobileSavedCartRestoreDto(
  val restoredCount: Int = 0,
  val skippedCount: Int = 0,
)

@Serializable
data class MobileSaveForLaterRequestDto(val cartItemId: String)

@Serializable
data class MobileOrderActionRequestDto(val reason: String)

@Serializable
data class MobileReturnRequestResponseDto(
  val id: String,
  val status: String,
)

@Serializable
data class MobileAccountRequestsDto(val requests: List<MobileAccountRequestDto> = emptyList())

@Serializable
data class MobileAccountRequestDto(
  val id: String,
  val requestType: String,
  val status: String,
  val createdAt: String,
)

@Serializable
data class MobileAccountRequestCreateDto(
  val requestType: String,
  val note: String = "",
)
