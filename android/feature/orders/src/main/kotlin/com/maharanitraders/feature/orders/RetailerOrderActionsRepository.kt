package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.MobileOrderActionRequestDto
import javax.inject.Inject
import javax.inject.Singleton

interface RetailerOrderActionsRepository {
  suspend fun cancelOrder(orderId: String, reason: String): AppResult<Unit>
  suspend fun requestReturn(orderId: String, reason: String): AppResult<String>
}

@Singleton
class NetworkRetailerOrderActionsRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : RetailerOrderActionsRepository {
  override suspend fun cancelOrder(orderId: String, reason: String): AppResult<Unit> =
    executor.executeEnvelope { api.cancelOrder(orderId, MobileOrderActionRequestDto(reason)) }.map { Unit }

  override suspend fun requestReturn(orderId: String, reason: String): AppResult<String> =
    executor.executeEnvelope { api.requestOrderReturn(orderId, MobileOrderActionRequestDto(reason)) }.map { it.id }
}
