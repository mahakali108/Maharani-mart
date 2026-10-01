package com.maharanitraders.core.designsystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Timestamps arrive as Postgres/PostgREST ISO-8601 UTC strings. The app shows
 * the UTC calendar date the server sent — never a locally reinterpreted date,
 * which could show a different day than the access period the server enforces.
 */
class IsoDateDisplayTest {

  @Test
  fun `formats a PostgREST timestamp as a UTC calendar date`() {
    assertEquals("08 Oct 2026", IsoDateDisplay.formatDate("2026-10-08T00:00:00.000Z"))
    assertEquals("01 Jan 2026", IsoDateDisplay.formatDate("2026-01-01T12:34:56+00:00"))
    assertEquals("31 Dec 2025", IsoDateDisplay.formatDate("2025-12-31T23:59:59.999Z"))
  }

  @Test
  fun `missing expiry dates render as nothing, not as an arbitrary date`() {
    assertNull(IsoDateDisplay.formatDate(null))
    assertNull(IsoDateDisplay.formatDate(""))
    assertNull(IsoDateDisplay.formatDate("   "))
  }

  @Test
  fun `an unexpected shape is shown unchanged instead of being mangled`() {
    assertEquals("not-a-date", IsoDateDisplay.formatDate("not-a-date"))
    assertEquals("2026-13-40T00:00:00Z", IsoDateDisplay.formatDate("2026-13-40T00:00:00Z"))
    assertEquals("2026/10/08", IsoDateDisplay.formatDate("2026/10/08"))
  }
}
