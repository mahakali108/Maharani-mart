package com.maharanitraders.core.designsystem

import kotlin.math.absoluteValue

/**
 * Money formatting for Indian retail pricing.
 *
 * The API transports money as integer **paise** (never floats), and every
 * amount the app displays was computed by the server. This object only formats
 * for display — it must never be used to calculate a total.
 *
 * Grouping is the Indian convention: last three digits, then pairs
 * (₹12,34,567.89), not the Western thousands convention.
 */
object MoneyFormat {

  const val RUPEE_SYMBOL = "₹"

  /** `123456789` paise → `₹12,34,567.89` */
  fun formatPaise(paise: Long): String {
    val negative = paise < 0
    val absolute = paise.absoluteValue
    val rupees = absolute / 100
    val fraction = absolute % 100

    return buildString {
      if (negative) append('-')
      append(RUPEE_SYMBOL)
      append(groupIndian(rupees))
      append('.')
      append(fraction.toString().padStart(2, '0'))
    }
  }

  /** Same as [formatPaise] but without the symbol (for table columns). */
  fun formatPaisePlain(paise: Long): String =
    formatPaise(paise).removePrefix(RUPEE_SYMBOL)

  /**
   * Display-only compact form: `₹1,200.00` → `₹1,200`, while `₹1,200.50` keeps
   * its paise. Wholesale rates are whole rupees far more often than not, and a
   * card column is narrow; the VALUE is untouched — only a zero fraction is
   * omitted, so this may never be used where an exact two-decimal figure is
   * required (invoices, the tier table).
   */
  fun formatPaiseShort(paise: Long): String {
    val formatted = formatPaise(paise)
    return if (formatted.endsWith(".00")) formatted.dropLast(3) else formatted
  }

  /** The Indian grouping rule, isolated so it is unit-testable on its own. */
  fun groupIndian(value: Long): String {
    val digits = value.absoluteValue.toString()
    if (digits.length <= 3) return if (value < 0) "-$digits" else digits

    val lastThree = digits.substring(digits.length - 3)
    var rest = digits.substring(0, digits.length - 3)

    val groups = mutableListOf<String>()
    while (rest.length > 2) {
      groups.add(0, rest.substring(rest.length - 2))
      rest = rest.substring(0, rest.length - 2)
    }
    if (rest.isNotEmpty()) groups.add(0, rest)

    val grouped = (groups + lastThree).joinToString(",")
    return if (value < 0) "-$grouped" else grouped
  }
}
