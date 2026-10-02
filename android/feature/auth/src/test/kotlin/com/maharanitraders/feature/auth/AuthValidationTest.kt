package com.maharanitraders.feature.auth

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/**
 * Pure validation tests — no Android framework, no coroutines.
 *
 * The phone normalizer is asserted against the same cases as the web app's
 * `lib/utils/phone.ts`, because a number that works on the website must work in
 * the app (and vice versa); a divergence here would look like "the app is
 * broken" for a specific customer.
 */
class AuthValidationTest {

  @Test
  fun `accepts every common Indian mobile format and canonicalises it`() {
    val expected = "9876543210"
    for (input in listOf(
      "9876543210",
      "09876543210",
      "+91 98765 43210",
      "+919876543210",
      "91-98765-43210",
      "091 9876543210",
    )) {
      assertThat(AuthValidation.normalizePhone(input)).isEqualTo(expected)
    }
  }

  @Test
  fun `rejects numbers that are not valid Indian mobiles`() {
    for (input in listOf(
      "",
      "12345",
      "1234567890",      // does not start 6–9
      "5876543210",      // does not start 6–9
      "+1 555 0100",     // not an Indian mobile
      "98765432101",     // too long, and not an 0/91 prefix
    )) {
      assertThat(AuthValidation.normalizePhone(input)).isNull()
    }
  }

  @Test
  fun `a sign-in identifier is an email or a phone, never neither`() {
    assertThat(AuthValidation.validateIdentifier("shop@example.com")).isNull()
    assertThat(AuthValidation.validateIdentifier("+91 98765 43210")).isNull()
    assertThat(AuthValidation.validateIdentifier("@example.com")).isNotNull()
    assertThat(AuthValidation.validateIdentifier("not a login")).isNotNull()
    assertThat(AuthValidation.validateIdentifier("  ")).isNotNull()
  }

  @Test
  fun `registration enforces the same rules as the server schema`() {
    assertThat(AuthValidation.validateFullName("Ramesh Kumar")).isNull()
    assertThat(AuthValidation.validateFullName("R")).isNotNull()

    assertThat(AuthValidation.validatePhone("+91 98765 43210")).isNull()
    assertThat(AuthValidation.validatePhone("12345")).isNotNull()

    assertThat(AuthValidation.validateAreaId("11111111-1111-4111-8111-111111111111")).isNull()
    assertThat(AuthValidation.validateAreaId("not-a-uuid")).isNotNull()

    assertThat(AuthValidation.validateNewPassword("12345678")).isNull()
    assertThat(AuthValidation.validateNewPassword("1234567")).isNotNull()
  }

  @Test
  fun `password confirmation must match`() {
    assertThat(AuthValidation.validateConfirmation("abcdefgh", "abcdefgh")).isNull()
    assertThat(AuthValidation.validateConfirmation("abcdefgh", "abcdefgi")).isNotNull()
  }
}
