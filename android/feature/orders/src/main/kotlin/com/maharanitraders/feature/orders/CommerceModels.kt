package com.maharanitraders.feature.orders

/** Intent sent to quote and submit endpoints; it contains no client price data. */
data class CartLineIntent(val packId: String, val quantity: Int)

data class CartSnapshot(
  val lines: List<CartLine>,
  val couponCode: String?,
  val couponUnavailable: Boolean,
  /**
   * Saved cart LINES, as the server counted them. This is the same fact the web
   * shell badges for the cart, so the native badge cannot disagree with the shop
   * the shopper sees on the cart screen.
   */
  val lineCount: Int = 0,
  /** Total pieces across the lines, as the server counted them. */
  val itemCount: Int = 0,
)

data class CartLine(
  val id: String,
  val packId: String,
  val productId: String?,
  val productName: String?,
  val packName: String?,
  val quantity: Int,
  val quantityUnit: String,
  /** Server-reported piece-cart step (1 for the current retailer contract). */
  val quantityIncrement: Int,
  val moq: Int?,
  val unitsPerCase: Int?,
  val unitPricePaise: Long?,
  val lineTotalPaise: Long?,
  val gstPercent: Double?,
  val availability: String,
  val orderable: Boolean,
  val message: String?,
)

data class DeliveryAddress(
  val id: String?,
  val label: String,
  val line: String,
  val receiverName: String?,
  val phone: String?,
  val isDefault: Boolean,
  /** Structured fields; only saved rows (id != null) have them. */
  val line1: String? = null,
  val line2: String? = null,
  val landmark: String? = null,
  val city: String? = null,
  val district: String? = null,
  val state: String? = null,
  val pincode: String? = null,
) {
  /** True when this row can be edited (saved addresses, not the shop address). */
  val isEditable: Boolean get() = id != null && line1 != null

  /** The editable draft this row represents. */
  fun toDraft(): AddressDraft = AddressDraft(
    label = label,
    receiverName = receiverName.orEmpty(),
    phone = phone.orEmpty(),
    line1 = line1.orEmpty(),
    line2 = line2.orEmpty(),
    landmark = landmark.orEmpty(),
    city = city.orEmpty(),
    district = district.orEmpty(),
    state = state.orEmpty().ifEmpty { AddressRules.DEFAULT_STATE },
    pincode = pincode.orEmpty(),
    isDefault = isDefault,
  )
}

data class QuoteLine(
  val packId: String,
  val productId: String,
  val productName: String,
  val packName: String,
  val quantity: Int,
  val quantityUnit: String,
  val moq: Int,
  val unitsPerCase: Int,
  val unitPricePaise: Long,
  val lineTotalPaise: Long,
  val gstPercent: Double,
  val availability: String,
  val orderable: Boolean,
)

data class CheckoutQuote(
  val lines: List<QuoteLine>,
  val subtotalPaise: Long,
  val gstTotalPaise: Long,
  val discountTotalPaise: Long,
  val grandTotalPaise: Long,
  val coinsBalancePaise: Long,
  val coinsUsedPaise: Long,
  val balanceAfterCoinsPaise: Long,
  val couponCode: String?,
  val address: DeliveryAddress,
)

data class OrderConfirmation(
  val id: String,
  val orderNumber: String,
  val status: String,
  val placedAt: String,
  val grandTotalPaise: Long,
  val coinsUsedPaise: Long?,
  val balanceAfterCoinsPaise: Long?,
  val idempotentReplay: Boolean,
)

data class OrderItem(
  val id: String,
  val productId: String,
  val packId: String?,
  val productName: String?,
  val packName: String?,
  val quantity: Int,
  val quantityUnit: String,
  val quantityPieces: Int?,
  val unitsPerCase: Int?,
  val unitPricePaise: Long,
  val gstPercent: Double,
  val lineTotalPaise: Long,
)

data class RetailerOrder(
  val id: String,
  val orderNumber: String,
  val status: String,
  val subtotalPaise: Long,
  val gstTotalPaise: Long,
  val discountTotalPaise: Long,
  val grandTotalPaise: Long,
  val placedAt: String,
  val updatedAt: String,
  val notes: String?,
  val shippingAddressLine: String?,
  val items: List<OrderItem>,
  val coinsUsedPaise: Long?,
  val balanceAfterCoinsPaise: Long?,
)

data class OrderHistoryPage(
  val orders: List<RetailerOrder>,
  val nextCursor: String?,
  val hasMore: Boolean,
)

data class CouponApplication(val code: String, val discountPaise: Long)


/** Test tag-free, pure address rules shared by the address screen and its tests. */
object AddressRules {
  const val LABEL_MAX = 40
  const val RECEIVER_MAX = 120
  const val LINE_MAX = 200
  const val LANDMARK_MAX = 120
  const val CITY_MAX = 120
  const val DISTRICT_MAX = 120
  const val STATE_MAX = 120
  const val DEFAULT_STATE = "Bihar"

  /**
   * The field messages are the server's own strings
   * (`lib/retailer/address-shared.ts`), so a shopper reads the same sentence
   * whether the web form or the app refuses the input — and the app never
   * invents a rule the server does not enforce.
   */
  fun validate(draft: AddressDraft): Map<String, String> {
    val errors = linkedMapOf<String, String>()
    val label = draft.label.trim()
    val receiver = draft.receiverName.trim()
    val phone = draft.phone.trim()
    val line1 = draft.line1.trim()
    val city = draft.city.trim()
    val pincode = draft.pincode.trim()

    if (label.isEmpty() || label.length > LABEL_MAX) {
      errors["label"] = "Give the address a label, e.g. Shop or Godown."
    }
    if (receiver.length < 2 || receiver.length > RECEIVER_MAX) {
      errors["receiverName"] = "Enter the receiver name."
    }
    if (phone.length < 5 || phone.length > 20) {
      errors["phone"] = "Enter a contact phone number."
    } else if (!phone.matches(Regex("^[0-9+\\-\\s]+$"))) {
      errors["phone"] = "Phone can contain digits, spaces, + and - only."
    }
    if (line1.length < 3 || line1.length > LINE_MAX) {
      errors["line1"] = "Enter the shop / building address."
    }
    if (draft.line2.trim().length > LINE_MAX) {
      errors["line2"] = "Keep this line under $LINE_MAX characters."
    }
    if (draft.landmark.trim().length > LANDMARK_MAX) {
      errors["landmark"] = "Keep the landmark under $LANDMARK_MAX characters."
    }
    if (city.length < 2 || city.length > CITY_MAX) {
      errors["city"] = "Enter the city or town."
    }
    if (draft.district.trim().length > DISTRICT_MAX) {
      errors["district"] = "Keep the district under $DISTRICT_MAX characters."
    }
    if (draft.state.trim().length > STATE_MAX) {
      errors["state"] = "Keep the state under $STATE_MAX characters."
    }
    if (!pincode.matches(Regex("^[0-9]{6}$"))) {
      errors["pincode"] = "PIN code must be exactly 6 digits."
    }
    return errors
  }
}

/**
 * One editable address, exactly the fields the server accepts.
 *
 * It is a draft, not state: the screen owns it while the shopper types, and the
 * SAVED address only ever comes back from the server. Nothing here can carry an
 * owner, a price or an id — the id being edited travels as its own argument so a
 * body can never target another retailer's row.
 */
data class AddressDraft(
  val label: String = "",
  val receiverName: String = "",
  val phone: String = "",
  val line1: String = "",
  val line2: String = "",
  val landmark: String = "",
  val city: String = "",
  val district: String = "",
  val state: String = AddressRules.DEFAULT_STATE,
  val pincode: String = "",
  val isDefault: Boolean = false,
) {
  companion object {
    /** The blank draft for a new address, pre-filled with the app's default state. */
    val EMPTY = AddressDraft()
  }
}

/**
 * One quick-order pack row: the server's price at MOQ, the pack's own MOQ and
 * whether loose pieces are allowed. Nothing here is computed on the device.
 */
data class QuickOrderPack(
  val packId: String,
  val packName: String,
  val unitsPerCase: Int,
  val moq: Int,
  val allowLoosePieces: Boolean,
  val unitPricePaise: Long?,
  val derivedPiecePricePaise: Long?,
  val mrpPaise: Long?,
  val availability: String,
) {
  /** True when the server priced this pack and called it orderable-ish. */
  val isPriced: Boolean get() = unitPricePaise != null
}

/** One product in the quick-order search results. */
data class QuickOrderProduct(
  val id: String,
  val name: String,
  val brandName: String?,
  val imageUrl: String?,
  val gstPercent: Double,
  val packs: List<QuickOrderPack>,
)

/** One pack candidate for a pasted line. */
data class BulkMatchPack(
  val packId: String,
  val packName: String,
  val moq: Int,
  val allowLoosePieces: Boolean,
  val unitPricePaise: Long?,
  val availability: String,
)

/**
 * One resolved pasted line: the product it matched, the packs that can fulfil
 * it and the quantity the paste asked for (null = use the pack MOQ).
 */
data class BulkMatchLine(
  val line: String,
  val quantity: Int?,
  val productId: String,
  val productName: String,
  val brandName: String?,
  val matches: List<BulkMatchPack>,
  val error: String?,
) {
  val matched: Boolean get() = error == null && matches.isNotEmpty()
}

/** A cart addition chosen from a quick-order row or a bulk match. */
data class QuickOrderSelection(
  val packId: String,
  val quantity: Int,
)
