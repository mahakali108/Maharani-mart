package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.MobileBulkMatchLineDto
import com.maharanitraders.core.network.dto.MobileBulkMatchPackDto
import com.maharanitraders.core.network.dto.MobileBulkMatchRequestDto
import com.maharanitraders.core.network.dto.MobileQuickOrderPackDto
import com.maharanitraders.core.network.dto.MobileQuickOrderProductDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reads for quick order: the name search and the pasted-list matcher.
 *
 * Both are `GET`-like: they resolve what the server would charge and whether a
 * pack can be ordered, and neither writes. Adding to the cart stays the cart
 * repository's job, so MOQ/availability revalidation happens in exactly one
 * place.
 */
interface QuickOrderRepository {
  suspend fun search(term: String): AppResult<List<QuickOrderProduct>>
  suspend fun matchLines(raw: String): AppResult<List<BulkMatchLine>>
}

@Singleton
class NetworkQuickOrderRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : QuickOrderRepository {

  override suspend fun search(term: String): AppResult<List<QuickOrderProduct>> =
    executor.executeEnvelope { api.quickOrder(q = term.trim()) }
      .map { dto -> dto.products.map(MobileQuickOrderProductDto::toDomain) }

  override suspend fun matchLines(raw: String): AppResult<List<BulkMatchLine>> =
    executor.executeEnvelope { api.matchBulkLines(MobileBulkMatchRequestDto(raw = raw)) }
      .map { dto -> dto.matches.map(MobileBulkMatchLineDto::toDomain) }
}

internal fun MobileQuickOrderPackDto.toDomain() = QuickOrderPack(
  packId = packId,
  packName = packName,
  unitsPerCase = unitsPerCase.coerceAtLeast(1),
  moq = moq.coerceAtLeast(1),
  allowLoosePieces = allowLoosePieces,
  unitPricePaise = unitPricePaise,
  derivedPiecePricePaise = derivedPiecePricePaise,
  mrpPaise = mrpPaise,
  availability = availability,
)

internal fun MobileQuickOrderProductDto.toDomain() = QuickOrderProduct(
  id = id,
  name = name,
  brandName = brandName,
  imageUrl = imageUrl,
  gstPercent = gstPercent,
  packs = packs.map(MobileQuickOrderPackDto::toDomain),
)

internal fun MobileBulkMatchPackDto.toDomain() = BulkMatchPack(
  packId = packId,
  packName = packName,
  moq = moq.coerceAtLeast(1),
  allowLoosePieces = allowLoosePieces,
  unitPricePaise = unitPricePaise,
  availability = availability,
)

internal fun MobileBulkMatchLineDto.toDomain() = BulkMatchLine(
  line = line,
  quantity = quantity,
  productId = productId,
  productName = productName,
  brandName = brandName,
  matches = matches.map(MobileBulkMatchPackDto::toDomain),
  error = error,
)
