package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class HomeBannerTargetTest {
  private val id = "12345678-1234-1234-1234-123456789abc"

  @Test fun `real product category and brand targets resolve natively`() {
    assertThat(homeBannerTarget("/retailer/catalog/$id")).isEqualTo(HomeBannerTarget.Product(id))
    assertThat(homeBannerTarget("/retailer/categories/$id")).isEqualTo(HomeBannerTarget.Catalog(categoryId = id))
    assertThat(homeBannerTarget("/retailer/brands/$id")).isEqualTo(HomeBannerTarget.Catalog(brandId = id))
    assertThat(homeBannerTarget("/retailer/catalog?q=rice+flour&brand=$id"))
      .isEqualTo(HomeBannerTarget.Catalog(search = "rice flour", brandId = id))
    assertThat(homeBannerTarget("/retailer/schemes")).isEqualTo(HomeBannerTarget.Offers)
    assertThat(homeBannerTarget("/retailer/coupons")).isEqualTo(HomeBannerTarget.Coupons)
  }

  @Test fun `unknown or unsafe targets never become a browser or native trampoline`() {
    listOf(null, "", "https://example.com/retailer/catalog", "//example.com/retailer/catalog",
      "/admin/catalog", "/retailer/catalog/not-an-id", "/retailer/catalog?brand=invalid",
      "/retailer/catalog#fragment", "/retailer/catalog?q=%ZZ", "/retailer/catalog/../orders",
      "/retailer/catalog/$id/extra", "/retailer/catalog\\evil", "/retailer/campaign/unknown").forEach {
      assertThat(homeBannerTarget(it)).isNull()
    }
  }
}
