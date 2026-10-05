package com.maharanitraders.feature.engagement.di

import com.maharanitraders.feature.engagement.EngagementRepository
import com.maharanitraders.feature.engagement.NetworkEngagementRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class EngagementFeatureModule {

  @Binds
  @Singleton
  abstract fun bindEngagementRepository(
    impl: NetworkEngagementRepository,
  ): EngagementRepository
}