package com.maharanitraders.feature.catalog

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.RetailerHome
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import javax.inject.Inject
import javax.inject.Singleton

/** One batch of catalogue products plus the server's own pagination facts. */
data class CatalogPage(
  val products: List<CatalogProduct>,
  /** Opaque continuation token; `null` means the list is complete. */
  val nextCursor: String?,
  val hasMore: Boolean,
  /** Exact match count, known on the first batch only. */
  val resultCount: Int?,
  /** True when the server capped the working set; the UI must disclose it. */
  val resultCapped: Boolean,
)

/**
 * Reads the catalogue from the server.
 *
 * An interface so the ViewModels can be tested without a network — and so there
 * is no room for an implementation that returns sample products. The migration
 * contract forbids mock catalogue data in production UI, and the only way to
 * keep that promise structurally is to have exactly one implementation, which
 * asks the server.
 */
interface CatalogRepository {

  suspend fun loadHome(): AppResult<RetailerHome>

  suspend fun loadCategories(): AppResult<List<CatalogCategory>>

  suspend fun loadBrands(): AppResult<List<CatalogBrand>>

  suspend fun loadProducts(query: CatalogQuery, cursor: String?): AppResult<CatalogPage>

  suspend fun loadProduct(id: String): AppResult<ProductDetail>
}

@Singleton
class NetworkCatalogRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : CatalogRepository {

  override suspend fun loadHome(): AppResult<RetailerHome> =
    executor.execute { api.retailerHome() }.map { CatalogMapper.home(it.data) }

  override suspend fun loadCategories(): AppResult<List<CatalogCategory>> =
    executor.execute { api.catalogCategories() }
      .map { it.data.categories.map(CatalogMapper::category) }

  override suspend fun loadBrands(): AppResult<List<CatalogBrand>> =
    executor.execute { api.catalogBrands() }
      .map { it.data.brands.map(CatalogMapper::brand) }

  override suspend fun loadProducts(query: CatalogQuery, cursor: String?): AppResult<CatalogPage> =
    executor
      .execute {
        api.catalogProducts(
          search = query.searchParam,
          categoryId = query.categoryId,
          brandId = query.brandId,
          sort = query.sortParam,
          inStock = query.inStockParam,
          // A blank cursor is the first batch. Retrofit drops nulls, so the
          // server never sees `cursor=` and never has to guess what it meant.
          cursor = cursor?.trim()?.ifEmpty { null },
        )
      }
      .map { envelope ->
        CatalogPage(
          products = CatalogMapper.products(envelope.data),
          nextCursor = envelope.page?.nextCursor,
          // `hasMore` comes from the server. Deriving it from "the batch was
          // full" would keep a list scrolling forever on an exact multiple of
          // the page size.
          hasMore = envelope.page?.hasMore == true,
          resultCount = envelope.meta?.resultCount,
          resultCapped = envelope.meta?.resultCapped == true,
        )
      }

  override suspend fun loadProduct(id: String): AppResult<ProductDetail> =
    executor.execute { api.catalogProduct(id) }.map { CatalogMapper.detail(it.data) }
}

/** True when the failure means "no connection", so the UI can say so plainly. */
val AppError.isOffline: Boolean get() = this is AppError.Network
