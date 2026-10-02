package com.maharanitraders.feature.auth

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import javax.inject.Inject
import javax.inject.Singleton

sealed interface AreaDirectoryResult {
  data class Loaded(val areas: List<AreaOption>) : AreaDirectoryResult
  data class Failed(val message: String) : AreaDirectoryResult
}

/**
 * Reads the active service areas from the server.
 *
 * An interface so the registration ViewModel can be tested without a network,
 * and — more importantly — so there is no implementation that could return a
 * hardcoded list. A registration form that invented an area would produce an
 * account the `handle_new_user()` trigger rejects, so the only acceptable
 * implementations are ones that ask the server.
 */
interface AreaDirectory {
  suspend fun load(): AreaDirectoryResult
}

@Singleton
class NetworkAreaDirectory @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : AreaDirectory {

  override suspend fun load(): AreaDirectoryResult =
    when (val result = executor.executeEnvelope { api.areas() }) {
      is AppResult.Success -> AreaDirectoryResult.Loaded(
        result.value.areas
          .filter { it.id.isNotBlank() && it.name.isNotBlank() }
          .map { AreaOption(id = it.id, name = it.name, district = it.district) }
      )
      is AppResult.Failure -> AreaDirectoryResult.Failed(result.error.message)
    }
}
