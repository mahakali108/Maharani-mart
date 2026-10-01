package com.maharanitraders.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * DataStore-backed [PreferenceStore] — the non-sensitive half of local storage.
 * Values are read once per call because preferences are consulted on user
 * actions, not on every frame.
 */
@Singleton
class DataStorePreferenceStore @Inject constructor(
  private val dataStore: DataStore<Preferences>,
) : PreferenceStore {

  override suspend fun getString(key: String): String? =
    dataStore.data.first()[stringPreferencesKey(key)]

  override suspend fun putString(key: String, value: String) {
    dataStore.edit { preferences -> preferences[stringPreferencesKey(key)] = value }
  }

  override suspend fun getBoolean(key: String): Boolean? =
    dataStore.data.first()[booleanPreferencesKey(key)]

  override suspend fun putBoolean(key: String, value: Boolean) {
    dataStore.edit { preferences -> preferences[booleanPreferencesKey(key)] = value }
  }

  override suspend fun getLong(key: String): Long? =
    dataStore.data.first()[longPreferencesKey(key)]

  override suspend fun putLong(key: String, value: Long) {
    dataStore.edit { preferences -> preferences[longPreferencesKey(key)] = value }
  }

  override suspend fun remove(key: String) {
    dataStore.edit { preferences ->
      preferences.remove(stringPreferencesKey(key))
      preferences.remove(booleanPreferencesKey(key))
      preferences.remove(longPreferencesKey(key))
    }
  }
}
