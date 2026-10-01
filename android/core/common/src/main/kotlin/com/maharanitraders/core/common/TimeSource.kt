package com.maharanitraders.core.common

import javax.inject.Inject
import javax.inject.Singleton

/**
 * Injectable clock so token-expiry logic is testable without sleeping and
 * without trusting the device wall clock implicitly (the API also returns
 * `serverTime`, which later phases can use to detect skew).
 */
fun interface TimeSource {
  fun nowEpochSeconds(): Long
}

@Singleton
class SystemTimeSource @Inject constructor() : TimeSource {
  override fun nowEpochSeconds(): Long = System.currentTimeMillis() / 1000
}
