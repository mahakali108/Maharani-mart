package com.maharanitraders.feature.catalog

import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.ApiErrorMapper
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.serialization.json.Json

/**
 * Shared test wiring for the catalogue module.
 *
 * The repository under test is the REAL [NetworkCatalogRepository]: only the
 * Retrofit interface behind it is faked. That keeps the mapping, the parameter
 * omission rules and the pagination handling inside the code being tested, so a
 * regression in any of them fails here rather than only on a device.
 */
internal fun catalogRepository(
  api: FakeCatalogApi,
  dispatcher: CoroutineDispatcher,
): NetworkCatalogRepository = NetworkCatalogRepository(
  api = api,
  executor = ApiCallExecutor(
    errorMapper = ApiErrorMapper(Json { ignoreUnknownKeys = true }),
    ioDispatcher = dispatcher,
  ),
)

/**
 * The REAL [FavoritesStore] over the faked Retrofit interface.
 *
 * Same reasoning as the repository above: faking the store would stop the tests
 * proving that favourite state is server-confirmed rather than guessed, which
 * is the whole point of having one store.
 */
internal fun favoritesStore(
  api: FakeCatalogApi,
  dispatcher: CoroutineDispatcher,
): FavoritesStore = FavoritesStore(
  api = api,
  executor = ApiCallExecutor(
    errorMapper = ApiErrorMapper(Json { ignoreUnknownKeys = true }),
    ioDispatcher = dispatcher,
  ),
)
