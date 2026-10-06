package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.MobileSavedCartCreateRequestDto
import com.maharanitraders.core.network.dto.MobileSavedCartDto
import com.maharanitraders.core.network.dto.MobileSavedCartRenameRequestDto
import com.maharanitraders.core.network.dto.MobileSaveForLaterRequestDto
import javax.inject.Inject
import javax.inject.Singleton

interface SavedCartsRepository {
  suspend fun loadSavedCarts(): AppResult<List<SavedCart>>
  suspend fun saveCurrentCart(name: String): AppResult<Unit>
  suspend fun renameSavedCart(id: String, name: String): AppResult<Unit>
  suspend fun deleteSavedCart(id: String): AppResult<Unit>
  suspend fun restoreSavedCart(id: String): AppResult<SavedCartRestoreResult>
  suspend fun saveForLater(cartItemId: String): AppResult<Unit>
  suspend fun deleteSavedItem(itemId: String): AppResult<Unit>
  suspend fun restoreSavedItem(itemId: String): AppResult<SavedCartRestoreResult>
}

data class SavedCart(
  val id: String,
  val name: String,
  val createdAt: String,
  val updatedAt: String,
  val items: List<SavedCartItem>,
)

data class SavedCartItem(
  val id: String,
  val productId: String,
  val packId: String,
  val productName: String?,
  val packName: String?,
  val quantity: Int,
)

data class SavedCartRestoreResult(val restoredCount: Int, val skippedCount: Int)

@Singleton
class NetworkSavedCartsRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : SavedCartsRepository {
  override suspend fun loadSavedCarts(): AppResult<List<SavedCart>> =
    executor.executeEnvelope { api.savedCarts() }.map { result -> result.savedCarts.map(MobileSavedCartDto::toDomain) }

  override suspend fun saveCurrentCart(name: String): AppResult<Unit> =
    executor.executeEnvelope { api.saveCurrentCart(MobileSavedCartCreateRequestDto(name)) }.map { Unit }

  override suspend fun renameSavedCart(id: String, name: String): AppResult<Unit> =
    executor.executeEnvelope { api.renameSavedCart(id, MobileSavedCartRenameRequestDto(name)) }.map { Unit }

  override suspend fun deleteSavedCart(id: String): AppResult<Unit> =
    executor.executeEnvelope { api.deleteSavedCart(id) }.map { Unit }

  override suspend fun restoreSavedCart(id: String): AppResult<SavedCartRestoreResult> =
    executor.executeEnvelope { api.restoreSavedCart(id) }.map { SavedCartRestoreResult(it.restoredCount, it.skippedCount) }

  override suspend fun saveForLater(cartItemId: String): AppResult<Unit> =
    executor.executeEnvelope { api.saveCartItemForLater(MobileSaveForLaterRequestDto(cartItemId)) }.map { Unit }

  override suspend fun deleteSavedItem(itemId: String): AppResult<Unit> =
    executor.executeEnvelope { api.deleteSavedCartItem(itemId) }.map { Unit }

  override suspend fun restoreSavedItem(itemId: String): AppResult<SavedCartRestoreResult> =
    executor.executeEnvelope { api.restoreSavedCartItem(itemId) }.map { SavedCartRestoreResult(it.restoredCount, it.skippedCount) }
}

private fun MobileSavedCartDto.toDomain() = SavedCart(
  id = id,
  name = name,
  createdAt = createdAt,
  updatedAt = updatedAt,
  items = items.map { item ->
    SavedCartItem(
      id = item.id,
      productId = item.productId,
      packId = item.packId,
      productName = item.productName,
      packName = item.packName,
      quantity = item.quantity,
    )
  },
)
