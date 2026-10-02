package com.maharanitraders.feature.auth.di

import com.maharanitraders.feature.auth.AreaDirectory
import com.maharanitraders.feature.auth.NetworkAreaDirectory
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Phase C wiring.
 *
 * The only binding is [AreaDirectory] → [NetworkAreaDirectory]. There is
 * deliberately no fake/offline implementation to bind: the app has no area list
 * of its own, and inventing one would create accounts the database rejects.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class AuthFeatureModule {

  @Binds
  @Singleton
  abstract fun bindAreaDirectory(impl: NetworkAreaDirectory): AreaDirectory
}
