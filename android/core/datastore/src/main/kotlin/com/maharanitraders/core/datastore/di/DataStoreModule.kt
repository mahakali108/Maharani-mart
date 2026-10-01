package com.maharanitraders.core.datastore.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import com.maharanitraders.core.datastore.DataStorePreferenceStore
import com.maharanitraders.core.datastore.PreferenceStore
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

@Module
@InstallIn(SingletonComponent::class)
abstract class DataStoreModule {

  @Binds
  @Singleton
  abstract fun bindPreferenceStore(impl: DataStorePreferenceStore): PreferenceStore

  companion object {
    @Provides
    @Singleton
    fun providePreferencesDataStore(
      @ApplicationContext context: Context,
    ): DataStore<Preferences> = PreferenceDataStoreFactory.create(
      scope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
      produceFile = { context.preferencesDataStoreFile("maharani_preferences") },
    )
  }
}
