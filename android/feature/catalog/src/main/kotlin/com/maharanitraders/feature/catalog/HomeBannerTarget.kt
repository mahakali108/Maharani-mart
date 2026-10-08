package com.maharanitraders.feature.catalog

import java.net.URI
import java.net.URLDecoder

/** Native allowlist, not a browser/deep-link trampoline. Unknown campaigns stay artwork. */
sealed interface HomeBannerTarget {
  data class Catalog(val search: String = "", val categoryId: String? = null, val brandId: String? = null) : HomeBannerTarget
  data class Product(val id: String) : HomeBannerTarget
  data object Offers : HomeBannerTarget
  data object Coupons : HomeBannerTarget
}

fun homeBannerTarget(raw: String?): HomeBannerTarget? {
  if (raw == null || !raw.startsWith("/retailer/") || raw.any { it == '\\' || it.code < 32 }) return null
  return runCatching {
    val uri = URI(raw)
    if (uri.isAbsolute || uri.rawAuthority != null || uri.fragment != null) return null
    val params = uri.rawQuery.orEmpty().split('&').filter { it.isNotBlank() }.associate {
      val pair = it.split('=', limit = 2)
      URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
    }
    val path = uri.path
    val id = path.substringAfterLast('/')
    fun validId(value: String?) = value?.matches(Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) == true
    when {
      path == "/retailer/catalog" -> {
        val category = params["category"]
        val brand = params["brand"]
        if ((category != null && !validId(category)) || (brand != null && !validId(brand))) null
        else HomeBannerTarget.Catalog(params["q"].orEmpty().take(120), category, brand)
      }
      path == "/retailer/schemes" -> HomeBannerTarget.Offers
      path == "/retailer/coupons" -> HomeBannerTarget.Coupons
      path.startsWith("/retailer/catalog/") && path.count { it == '/' } == 3 && validId(id) -> HomeBannerTarget.Product(id)
      path.startsWith("/retailer/categories/") && path.count { it == '/' } == 3 && validId(id) -> HomeBannerTarget.Catalog(categoryId = id)
      path.startsWith("/retailer/brands/") && path.count { it == '/' } == 3 && validId(id) -> HomeBannerTarget.Catalog(brandId = id)
      else -> null
    }
  }.getOrNull()
}
