package com.maharanitraders.feature.engagement.di

import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.feature.engagement.EngagementRepository
import com.maharanitraders.feature.engagement.NetworkEngagementRepository
import com.maharanitraders.feature.engagement.UnreadStore
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class EngagementFeatureModule {

  @Binds
  @Singleton
  abstract fun bindEngagementRepository(
    impl: NetworkEngagementRepository,
  ): EngagementRepository

  /** The unread count belongs to the signed-in recipient, so it goes with the session. */
  @Binds
  @IntoSet
  abstract fun bindUnreadSessionScoped(impl: UnreadStore): SessionScopedStore
}