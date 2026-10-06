package com.maharanitraders.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Order-journey wire shapes: the detail extras, the GST invoice and the
 * delivery record.
 *
 * Every monetary field is integer paise, produced by the server (contract
 * §1.5). Nothing in these DTOs computes tax, a total or a return window — the
 * server sends the decided values and the app only lays them out.
 */

/** One status-history row, oldest first, exactly as the server stores it. */
@Serializable
data class MobileOrderStatusEntryDto(
  val id: String,
  val status: String,
  val note: String? = null,
  val createdAt: String,
)

/** Who issued the invoice. Any field may be absent when not configured. */
@Serializable
data class MobileInvoiceBillerDto(
  val name: String? = null,
  val gstin: String? = null,
  val address: String? = null,
  val phone: String? = null,
)

/** The retailer the invoice is billed to. */
@Serializable
data class MobileInvoiceBilledToDto(
  val shopName: String? = null,
  val address: String? = null,
  val areaName: String? = null,
  val gstin: String? = null,
)

/** One billed unit price of an invoice line ('pc' or 'case'). */
@Serializable
data class MobileInvoiceUnitPriceDto(
  val unitPricePaise: Long,
  val unit: String,
)

/**
 * One folded invoice line. The server already decided every figure here,
 * including the tax split, using the same helpers the web invoice prints.
 */
@Serializable
data class MobileInvoiceLineDto(
  val key: String,
  val displayName: String,
  val packName: String,
  val hsn: String? = null,
  val quantityLabel: String,
  val unitPrices: List<MobileInvoiceUnitPriceDto> = emptyList(),
  val gstPercent: Double,
  val lineTotalPaise: Long,
  val taxPaise: Long = 0,
  val cgstPaise: Long = 0,
  val sgstPaise: Long = 0,
  val igstPaise: Long = 0,
)

/**
 * Invoice totals in paise.
 *
 * [gstTotalPaise] is the STORED order tax (what the web invoice prints);
 * [cgstPaise]/[sgstPaise]/[igstPaise] are the computed split for the
 * `taxMode` — shown only when the server split the tax.
 */
@Serializable
data class MobileInvoiceTotalsDto(
  val subtotalPaise: Long,
  val gstTotalPaise: Long,
  val cgstPaise: Long = 0,
  val sgstPaise: Long = 0,
  val igstPaise: Long = 0,
  val discountPaise: Long = 0,
  val grandTotalPaise: Long,
)

/** One order's GST invoice; `taxMode` is 'intra', 'inter' or 'unsplit'. */
@Serializable
data class MobileInvoiceDto(
  val orderId: String,
  val orderNumber: String,
  val status: String,
  val placedAt: String,
  val biller: MobileInvoiceBillerDto = MobileInvoiceBillerDto(),
  val billedTo: MobileInvoiceBilledToDto = MobileInvoiceBilledToDto(),
  val taxMode: String = "unsplit",
  val lines: List<MobileInvoiceLineDto> = emptyList(),
  val totals: MobileInvoiceTotalsDto,
)

/** Proof-of-delivery files: signed URLs, plus whether each was captured. */
@Serializable
data class MobileDeliveryProofDto(
  val signatureCaptured: Boolean = false,
  val photoCaptured: Boolean = false,
  val signatureUrl: String? = null,
  val photoUrl: String? = null,
)

/** One delivery line: what was ordered versus what actually changed hands. */
@Serializable
data class MobileDeliveryItemDto(
  val id: String,
  val productName: String? = null,
  val packName: String? = null,
  val quantityOrdered: Int = 0,
  val quantityDelivered: Int = 0,
  val quantityMissing: Int = 0,
  val quantityDamaged: Int = 0,
  val lineTotalPaise: Long = 0,
)

/**
 * The delivery record for one order.
 *
 * [returnWindowOpen] is the server's inclusive-deadline decision (null when
 * there is no deadline yet) — the app never compares dates itself.
 */
@Serializable
data class MobileDeliveryDto(
  val orderId: String,
  val orderNumber: String,
  val orderStatus: String,
  val grandTotalPaise: Long,
  val placedAt: String,
  val shippingAddressLine: String? = null,
  val status: String,
  val assignedName: String? = null,
  val assignedAt: String? = null,
  val dispatchedAt: String? = null,
  val inProgressAt: String? = null,
  val deliveredAt: String? = null,
  val receiverName: String? = null,
  val otpVerifiedAt: String? = null,
  val otpVerified: Boolean = false,
  val deliveryNotes: String? = null,
  val failureReason: String? = null,
  val returnWindowDays: Int? = null,
  val returnDeadline: String? = null,
  val returnWindowOpen: Boolean? = null,
  val proof: MobileDeliveryProofDto = MobileDeliveryProofDto(),
  val items: List<MobileDeliveryItemDto> = emptyList(),
)
