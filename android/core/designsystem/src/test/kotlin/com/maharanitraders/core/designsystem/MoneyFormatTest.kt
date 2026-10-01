package com.maharanitraders.core.designsystem

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Money is transported in paise and formatted for Indian retail display.
 * These cases pin the grouping rule, the two-decimal rule and the sign.
 */
class MoneyFormatTest {

  @Test
  fun `formats whole rupees with two decimals`() {
    assertEquals("₹1.00", MoneyFormat.formatPaise(100))
    assertEquals("₹10.00", MoneyFormat.formatPaise(1_000))
    assertEquals("₹0.00", MoneyFormat.formatPaise(0))
  }

  @Test
  fun `formats paise below one rupee`() {
    assertEquals("₹0.05", MoneyFormat.formatPaise(5))
    assertEquals("₹0.99", MoneyFormat.formatPaise(99))
  }

  @Test
  fun `uses Indian digit grouping, not thousands grouping`() {
    assertEquals("₹1,000.00", MoneyFormat.formatPaise(100_000))
    assertEquals("₹10,000.00", MoneyFormat.formatPaise(1_000_000))
    assertEquals("₹1,00,000.00", MoneyFormat.formatPaise(10_000_000))
    assertEquals("₹12,34,567.89", MoneyFormat.formatPaise(123_456_789))
    assertEquals("₹1,23,45,678.90", MoneyFormat.formatPaise(1_234_567_890))
  }

  @Test
  fun `handles negative amounts (refunds, adjustments) without losing the sign`() {
    assertEquals("-₹12,34,567.89", MoneyFormat.formatPaise(-123_456_789))
    assertEquals("-₹0.05", MoneyFormat.formatPaise(-5))
  }

  @Test
  fun `groupIndian is correct at the boundaries`() {
    assertEquals("0", MoneyFormat.groupIndian(0))
    assertEquals("999", MoneyFormat.groupIndian(999))
    assertEquals("1,000", MoneyFormat.groupIndian(1_000))
    assertEquals("99,999", MoneyFormat.groupIndian(99_999))
    assertEquals("1,00,000", MoneyFormat.groupIndian(100_000))
    assertEquals("10,00,000", MoneyFormat.groupIndian(1_000_000))
  }

  @Test
  fun `plain formatting keeps digits usable in dense tables`() {
    assertEquals("12,34,567.89", MoneyFormat.formatPaisePlain(123_456_789))
    assertEquals("0.00", MoneyFormat.formatPaisePlain(0))
  }
}
