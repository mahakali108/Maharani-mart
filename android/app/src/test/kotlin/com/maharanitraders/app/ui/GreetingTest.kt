package com.maharanitraders.app.ui

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/**
 * The greeting is the first thing a shopkeeper reads, and it is wrong on every
 * device in India if the hour is read as UTC. These cases pin the IST shift and
 * its boundaries against a fixed instant.
 */
class GreetingTest {

  /** 2026-10-05 is an arbitrary date; only the time of day matters here. */
  private fun atIst(hour: Int): Long {
    val midnightUtc = 1_796_601_600L // 2026-10-05T00:00:00Z
    return midnightUtc + hour * 3600L - IST_OFFSET_SECONDS
  }

  @Test
  fun `shifts UTC into the shop's own evening`() {
    // 15:30 UTC is 21:00 in India: "Good evening", not "Good afternoon".
    assertThat(greetingFor(1_796_601_600L + 15 * 3600L + 30 * 60L)).isEqualTo("Good evening")
  }

  @Test
  fun `covers every part of the Indian day`() {
    assertThat(greetingFor(atIst(6))).isEqualTo("Good morning")
    assertThat(greetingFor(atIst(11))).isEqualTo("Good morning")
    assertThat(greetingFor(atIst(12))).isEqualTo("Good afternoon")
    assertThat(greetingFor(atIst(16))).isEqualTo("Good afternoon")
    assertThat(greetingFor(atIst(17))).isEqualTo("Good evening")
    assertThat(greetingFor(atIst(20))).isEqualTo("Good evening")
    assertThat(greetingFor(atIst(21))).isEqualTo("Good night")
    assertThat(greetingFor(atIst(4))).isEqualTo("Good night")
  }
}
