package com.maharanitraders.feature.catalog

import com.maharanitraders.core.datastore.PreferenceStore
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

/**
 * The REAL [LocalHistoryStore] over an in-memory preference store.
 *
 * The store itself is what is being tested (encoding, ordering, the cap and the
 * session wipe), so only DataStore is doubled — a fake history store would prove
 * nothing about the behaviour the home rail and the search chips depend on.
 */
internal fun localHistoryStore(
  preferences: PreferenceStore = InMemoryPreferenceStore(),
): LocalHistoryStore = LocalHistoryStore(preferences)

/**
 * Deterministic in-memory double for [PreferenceStore].
 *
 * Deliberately literal: it stores and returns exactly what it was given, so a
 * round-trip failure in the store under test is a real encoding bug rather than
 * a difference between two implementations.
 */
internal class InMemoryPreferenceStore : PreferenceStore {

  private val strings = mutableMapOf<String, String>()
  private val booleans = mutableMapOf<String, Boolean>()
  private val longs = mutableMapOf<String, Long>()

  override suspend fun getString(key: String): String? = strings[key]

  override suspend fun putString(key: String, value: String) {
    strings[key] = value
  }

  override suspend fun getBoolean(key: String): Boolean? = booleans[key]

  override suspend fun putBoolean(key: String, value: Boolean) {
    booleans[key] = value
  }

  override suspend fun getLong(key: String): Long? = longs[key]

  override suspend fun putLong(key: String, value: Long) {
    longs[key] = value
  }

  override suspend fun remove(key: String) {
    strings.remove(key)
    booleans.remove(key)
    longs.remove(key)
  }
}
