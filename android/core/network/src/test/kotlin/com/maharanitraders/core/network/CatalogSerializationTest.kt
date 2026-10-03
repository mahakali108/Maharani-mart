package com.maharanitraders.core.network

import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Catalogue serialization contract.
 *
 * The JSON bodies below are transcribed from the real route handlers
 * (`app/api/mobile/v1/catalog/products/route.ts` and friends), and the field
 * names on both sides are additionally locked by
 * `tests/mobile-catalog-api.test.ts`, which compares the route output to these
 * DTOs field for field. Together they mean a renamed server field is a failing
 * test on one side or the other, not a silently empty product card.
 */
class CatalogSerializationTest {

  private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
  }

  /** Collection payloads come back as `{ "data": [...] }`, so decode the list. */
  private inline fun <reified T> decodeList(body: String): ApiEnvelope<List<T>> {
    return json.decodeFromString(ApiEnvelope.serializer(ListSerializer(serializer<T>())), body)
  }

  @Test
  fun `parses the collection envelope with its page block`() {
    val body = """
      {
        "data": [
          {
            "id": "33333333-3333-4333-8333-333333333331",
            "name": "Basmati Rice 500g",
            "brandName": "Maharani",
            "imageUrl": "https://cdn.maharanitraders.test/storage/v1/object/public/product-images/p1.jpg",
            "isNewLaunch": true,
            "categoryId": "c1",
            "brandId": "b1",
            "createdAt": "2026-03-01T00:00:00.000Z",
            "hasOffer": false,
            "isFavorite": false,
            "pack": {
              "packId": "44444444-4444-4444-8444-444444444441",
              "packName": "500g",
              "unitsPerCase": 4,
              "moq": 4,
              "unitPricePaise": 25000,
              "mrpPaise": 30000,
              "derivedCasePricePaise": 100000,
              "tiers": [
                { "minQuantity": 1, "maxQuantity": 6, "pricePerPiecePaise": 26000 },
                { "minQuantity": 6, "maxQuantity": null, "pricePerPiecePaise": 25000 }
              ],
              "availability": "in_stock"
            }
          }
        ],
        "page": { "nextCursor": "eyJrIjoia2V5c2V0In0", "hasMore": true, "limit": 24 },
        "meta": { "resultCount": 132, "resultCapped": false },
        "requestId": "0f1c2d3e"
      }
    """.trimIndent()

    val envelope: ApiEnvelope<List<CatalogProductDto>> = decodeList(body)

    assertEquals("0f1c2d3e", envelope.requestId)
    // Assert once through a local: after the first `!!` the compiler smart-casts
    // `envelope.page`, so a second assertion on it is a warning, not a check.
    val page = envelope.page!!
    assertEquals("eyJrIjoia2V5c2V0In0", page.nextCursor)
    assertTrue(page.hasMore)
    assertEquals(24, page.limit)
    val meta = envelope.meta!!
    assertEquals(132, meta.resultCount)
    assertFalse(meta.resultCapped)

    val card = envelope.data.single()
    assertEquals("Basmati Rice 500g", card.name)
    val pack = card.pack!!
    assertEquals("500g", pack.packName)
    // Money stays an integer all the way through parsing.
    assertEquals(25000L, pack.unitPricePaise)
    assertEquals(30000L, pack.mrpPaise)
    assertEquals(100000L, pack.derivedCasePricePaise)
    assertEquals(4, pack.moq)
    assertEquals(4, pack.unitsPerCase)
    assertEquals("in_stock", pack.availability)
    assertEquals(2, pack.tiers.size)
    assertEquals(26000L, pack.tiers.first().pricePerPiecePaise)
    assertNull(pack.tiers.last().maxQuantity)
  }

  @Test
  fun `defaults a missing pack, price and availability instead of failing`() {
    val body = """
      { "data": [ { "id": "p1", "name": "Unpriced" } ], "page": { "hasMore": false, "limit": 24 } }
    """.trimIndent()

    val envelope: ApiEnvelope<List<CatalogProductDto>> = decodeList(body)

    val card = envelope.data.single()
    assertNull(card.pack)
    assertNull(card.imageUrl)
    assertFalse(card.isNewLaunch)
    val page = envelope.page!!
    assertFalse(page.hasMore)
    assertNull(page.nextCursor)
    assertNull(envelope.meta)
  }

  @Test
  fun `tolerates a newer server adding fields to a catalogue card`() {
    val body = """
      {
        "data": [ {
          "id": "p1",
          "name": "Rice",
          "pack": { "packId": "k1", "packName": "1kg", "availability": "in_stock",
                    "unitPricePaise": 100, "someFutureField": { "a": 1 } },
          "anotherFutureField": "x"
        } ],
        "page": { "hasMore": false, "limit": 24 }
      }
    """.trimIndent()

    val envelope: ApiEnvelope<List<CatalogProductDto>> = decodeList(body)
    assertEquals("Rice", envelope.data.single().name)
    assertEquals(100L, envelope.data.single().pack!!.unitPricePaise)
  }

  @Test
  fun `parses the product detail with every pack priced at its own moq`() {
    val body = """
      {
        "data": {
          "id": "p1", "name": "Basmati Rice", "brandName": "Maharani",
          "brandId": "b1", "categoryId": "c1", "categoryName": "Rice",
          "unit": "carton", "hsnCode": "1006", "gstPercent": 5.0,
          "leadTimeDays": 2, "isNewLaunch": true, "isFavorite": false, "hasOffer": true,
          "images": ["https://cdn.maharanitraders.test/storage/v1/object/public/product-images/p1.jpg"],
          "packs": [
            {
              "packId": "pack-1", "packName": "500g", "unitsPerCase": 4, "moq": 4,
              "allowLoosePieces": true, "unitPricePaise": 25000, "lineTotalAtMoqPaise": 100000,
              "gstPercent": 5.0, "mrpPaise": 30000, "derivedCasePricePaise": 100000,
              "tiers": [], "availability": "in_stock", "selected": true,
              "images": ["https://cdn.maharanitraders.test/storage/v1/object/public/product-images/pack1.jpg"],
              "message": null
            },
            {
              "packId": "pack-2", "packName": "1kg", "unitsPerCase": 8, "moq": 8,
              "allowLoosePieces": false, "unitPricePaise": null, "lineTotalAtMoqPaise": null,
              "gstPercent": 5.0, "mrpPaise": null, "derivedCasePricePaise": null,
              "tiers": [], "availability": "out_of_stock", "selected": false, "images": [],
              "message": "Please set a selling price for this pack before ordering."
            }
          ]
        },
        "requestId": "abc"
      }
    """.trimIndent()

    val envelope = json.decodeFromString(ApiEnvelope.serializer(ProductDetailDto.serializer()), body)
    val detail = envelope.data

    assertEquals("Basmati Rice", detail.name)
    assertEquals(5.0, detail.gstPercent, 0.0001)
    assertEquals(2, detail.packs.size)

    val first = detail.packs[0]
    assertTrue(first.selected)
    assertEquals(25000L, first.unitPricePaise)
    assertEquals(100000L, first.lineTotalAtMoqPaise)
    assertTrue(first.allowLoosePieces)

    val second = detail.packs[1]
    // An unpriced pack stays null; it is never coerced to zero.
    assertNull(second.unitPricePaise)
    assertNull(second.lineTotalAtMoqPaise)
    assertFalse(second.allowLoosePieces)
    assertEquals("out_of_stock", second.availability)
    assertEquals("Please set a selling price for this pack before ordering.", second.message)
  }

  @Test
  fun `parses the home payload with banners, taxonomy and a discovery batch`() {
    val body = """
      {
        "data": {
          "banners": [
            { "id": "b1", "title": "Diwali deals", "subtitle": "Up to 12% off",
              "imageUrl": "https://cdn.maharanitraders.test/storage/v1/object/public/banners/d.jpg",
              "ctaLabel": "Shop now", "linkUrl": "/retailer/catalog" }
          ],
          "categories": [
            { "id": "c1", "name": "Rice", "imageUrl": null, "parentName": null, "productCount": 12 },
            { "id": "c2", "name": "Oils", "imageUrl": null, "parentName": null, "productCount": null }
          ],
          "brands": [ { "id": "b1", "name": "Maharani", "logoUrl": null, "productCount": 4 } ],
          "products": [ { "id": "p1", "name": "Rice" } ],
          "nextCursor": null
        },
        "requestId": "home-1"
      }
    """.trimIndent()

    val home = json.decodeFromString(ApiEnvelope.serializer(RetailerHomeDto.serializer()), body).data

    assertEquals(1, home.banners.size)
    assertEquals("/retailer/catalog", home.banners.single().linkUrl)
    assertEquals(2, home.categories.size)
    // A category the server could not count stays uncounted, never zero.
    assertNull(home.categories[1].productCount)
    assertEquals(1, home.brands.size)
    assertEquals(1, home.products.size)
    assertNull(home.nextCursor)
  }

  @Test
  fun `parses the taxonomy envelopes`() {
    val categories = json.decodeFromString(
      ApiEnvelope.serializer(CatalogCategoriesDto.serializer()),
      """{ "data": { "categories": [ { "id": "c1", "name": "Rice", "productCount": 3 } ] } }""",
    )
    assertEquals("Rice", categories.data.categories.single().name)
    assertEquals(3, categories.data.categories.single().productCount)

    val brands = json.decodeFromString(
      ApiEnvelope.serializer(CatalogBrandsDto.serializer()),
      """{ "data": { "brands": [ { "id": "b1", "name": "Fortune" } ] } }""",
    )
    assertEquals("Fortune", brands.data.brands.single().name)
    assertNull(brands.data.brands.single().productCount)
  }
}
