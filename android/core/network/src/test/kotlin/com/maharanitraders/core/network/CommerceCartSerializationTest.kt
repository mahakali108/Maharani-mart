package com.maharanitraders.core.network

import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.MobileCartDto
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cart serialization contract.
 *
 * The JSON below is transcribed from `GET /api/mobile/v1/cart`
 * (`lib/mobile/commerce-service.ts` `loadMobileCart`), and the same field names
 * are locked on the server side by `tests/mobile-cart-service.test.ts`. Between
 * the two, a renamed field is a failing test on one side or the other instead
 * of a cart row that quietly loses its brand or picture.
 */
class CommerceCartSerializationTest {

  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
  }

  private fun decodeCart(body: String): MobileCartDto =
    json.decodeFromString(ApiEnvelope.serializer(MobileCartDto.serializer()), body).data

  @Test
  fun `decodes a cart line with its brand, artwork and server facts`() {
    val body = """
      {
        "data": {
          "lines": [
            {
              "id": "44444444-4444-4444-8444-444444444444",
              "packId": "33333333-3333-4333-8333-333333333333",
              "productId": "22222222-2222-4222-8222-222222222222",
              "productName": "Basmati Rice 5kg",
              "brandName": "Maharani",
              "imageUrl": "https://cdn.maharanitraders.test/storage/v1/object/public/product-images/pack.jpg",
              "packName": "5 kg",
              "quantity": 6,
              "quantityUnit": "pieces",
              "quantityIncrement": 1,
              "moq": 6,
              "unitsPerCase": 12,
              "unitPricePaise": 10000,
              "lineTotalPaise": 60000,
              "gstPercent": 5,
              "availability": "in_stock",
              "orderable": true,
              "message": null
            }
          ],
          "couponCode": "WELCOME10",
          "couponUnavailable": false,
          "lineCount": 1,
          "itemCount": 6
        },
        "requestId": "req-1"
      }
    """.trimIndent()

    val cart = decodeCart(body)
    assertEquals(1, cart.lines.size)
    assertEquals(1, cart.lineCount)
    assertEquals(6, cart.itemCount)
    assertEquals("WELCOME10", cart.couponCode)

    val line = cart.lines.single()
    assertEquals("Maharani", line.brandName)
    assertEquals("5 kg", line.packName)
    assertEquals(6, line.moq)
    assertEquals(12, line.unitsPerCase)
    assertEquals(10000L, line.unitPricePaise)
    assertEquals(60000L, line.lineTotalPaise)
    assertTrue(line.imageUrl!!.endsWith("pack.jpg"))
    assertTrue(line.orderable)
    assertNull(line.message)
  }

  @Test
  fun `a line without artwork or brand still parses and keeps its blocker text`() {
    val body = """
      {
        "data": {
          "lines": [
            {
              "id": "44444444-4444-4444-8444-444444444445",
              "packId": "33333333-3333-4333-8333-333333333334",
              "quantity": 2,
              "availability": "out_of_stock",
              "orderable": false,
              "message": "Out of stock right now. Remove it, or check back soon."
            }
          ],
          "lineCount": 1,
          "itemCount": 2
        }
      }
    """.trimIndent()

    val line = decodeCart(body).lines.single()
    assertNull(line.brandName)
    assertNull(line.imageUrl)
    assertNull(line.productName)
    assertNull(line.unitPricePaise)
    // Defaults, not crashes: the older payload shape must still decode.
    assertEquals("pieces", line.quantityUnit)
    assertEquals(1, line.quantityIncrement)
    assertEquals("out_of_stock", line.availability)
    assertFalse(line.orderable)
    assertTrue(line.message!!.contains("Out of stock"))
  }

  @Test
  fun `an empty cart decodes as an empty list and a zero badge`() {
    val cart = decodeCart("""{"data": {"lines": [], "lineCount": 0, "itemCount": 0}}""")
    assertTrue(cart.lines.isEmpty())
    assertEquals(0, cart.lineCount)
    assertEquals(0, cart.itemCount)
    assertNull(cart.couponCode)
    assertFalse(cart.couponUnavailable)
  }
}
