package com.maharanitraders.core.network

import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.ManagedPageDto
import com.maharanitraders.core.network.dto.ManagedPagesDto
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Contract tests for `GET /api/mobile/v1/pages` and `/pages/{slug}`
 * (`docs/NATIVE_ANDROID_API_CONTRACT.md` §2.4.1).
 *
 * The JSON below is the shape the route actually returns inside the standard
 * `{ ok, data }` envelope. Parsing it here proves three things an app release
 * depends on:
 *  - the field names match the server (`navLabel`, `effectiveDate`, …);
 *  - a NEW server field never breaks an old app (`ignoreUnknownKeys`);
 *  - an absent optional field is a legal answer, not a parse failure.
 */
class ManagedContentSerializationTest {

  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
  }

  @Test
  fun `the page list parses the server's field names`() {
    val body = """
      {
        "ok": true,
        "data": {
          "pages": [
            {
              "slug": "about",
              "kind": "page",
              "audience": "everyone",
              "navLabel": "About us",
              "shortLabel": "About",
              "title": "About Maharani Traders",
              "summary": "Who we are.",
              "version": "1.0",
              "effectiveDate": "2026-11-14",
              "aFieldFromAFutureRelease": 42
            }
          ]
        }
      }
    """.trimIndent()

    val page = json.decodeFromString<ApiEnvelope<ManagedPagesDto>>(body).data.pages.single()
    assertEquals("about", page.slug)
    assertEquals("About us", page.navLabel)
    assertEquals("About", page.shortLabel)
    assertEquals("1.0", page.version)
    assertEquals("2026-11-14", page.effectiveDate)
  }

  @Test
  fun `an empty page list is a legal answer`() {
    val pages = json.decodeFromString<ApiEnvelope<ManagedPagesDto>>("""{"ok":true,"data":{"pages":[]}}""")
    assertTrue(pages.data.pages.isEmpty())
  }

  @Test
  fun `a page parses sections, bullets and the legal metadata`() {
    val body = """
      {
        "ok": true,
        "data": {
          "slug": "terms",
          "kind": "legal",
          "audience": "everyone",
          "navLabel": "Terms",
          "title": "Terms and Conditions",
          "eyebrow": "Legal",
          "intro": "The rules for using this shop.",
          "version": "1.0",
          "effectiveDate": "2026-11-14",
          "publishedAt": "2026-11-14T00:00:00+00:00",
          "showContactDetails": true,
          "relatedSlugs": ["privacy", "returns"],
          "sections": [
            {
              "heading": "Orders",
              "paragraphs": ["An order is a request until we accept it."],
              "bullets": ["Prices include GST", "Delivery in 2-5 days"],
              "tone": "standard",
              "imageUrl": null,
              "linkLabel": "Contact us",
              "linkHref": "/contact"
            }
          ]
        }
      }
    """.trimIndent()

    val page = json.decodeFromString<ApiEnvelope<ManagedPageDto>>(body).data
    assertEquals("Terms and Conditions", page.title)
    assertTrue(page.showContactDetails)
    assertEquals(listOf("privacy", "returns"), page.relatedSlugs)
    val section = page.sections.single()
    assertEquals("Orders", section.heading)
    assertEquals(2, section.bullets.size)
    assertEquals("/contact", section.linkHref)
  }

  @Test
  fun `every optional field may be absent`() {
    // The leanest answer the server can legally give: a published page with only a
    // title. The app must render it, not crash and not show an error.
    val page = json.decodeFromString<ApiEnvelope<ManagedPageDto>>("""{"ok":true,"data":{"slug":"about","title":"About"}}""").data
    assertTrue(page.sections.isEmpty())
    assertTrue(page.relatedSlugs.isEmpty())
    assertEquals(false, page.showContactDetails)
    assertEquals("", page.intro)
    assertNull(page.eyebrow)
  }
}
