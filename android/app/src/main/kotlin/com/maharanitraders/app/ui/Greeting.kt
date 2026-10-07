package com.maharanitraders.app.ui

/**
 * The shop's greeting, from the clock the shop actually keeps.
 *
 * Maharani Traders trades in India, and every timestamp the API sends is UTC,
 * so the hour is shifted to IST (+5:30) before it decides between "morning" and
 * "evening". A greeting that flips to "Good night" at 18:30 because the server
 * spoke UTC is the kind of small wrongness that makes an app feel foreign.
 *
 * Pure and injected-clock friendly: it takes epoch seconds, so a test can pin
 * every boundary without waiting for the wall clock.
 */
internal const val IST_OFFSET_SECONDS = 5L * 3600L + 30L * 60L

fun greetingFor(epochSeconds: Long): String {
  val hourOfDay = ((epochSeconds + IST_OFFSET_SECONDS) / 3600L % 24L).toInt()
  return when (hourOfDay) {
    in 5..11 -> "Good morning"
    in 12..16 -> "Good afternoon"
    in 17..20 -> "Good evening"
    else -> "Good night"
  }
}
