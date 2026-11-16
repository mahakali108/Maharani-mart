package com.maharanitraders.feature.engagement.di

import com.maharanitraders.core.common.SessionScopedStore
import com.maharanitraders.feature.engagement.ManagedContentRepository
import com.maharanitraders.feature.engagement.NetworkManagedContentRepository
import com.maharanitraders.feature.engagement.EngagementRepository
import com.maharanitraders.feature.engagement.NetworkEngagementRepository
import com.maharanitraders.feature.engagement.NetworkRetailerUpgradeRepository
import com.maharanitraders.feature.engagement.RetailerUpgradeRepository
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

  /**
   * Published website content (About / legal pages). One instance is enough: it
   * holds no state, and every screen asks the server for the current wording.
   */
  @Binds
  @Singleton
  abstract fun bindManagedContentRepository(
    impl: NetworkManagedContentRepository,
  ): ManagedContentRepository

  @Binds
  @Singleton
  abstract fun bindRetailerUpgradeRepository(
    impl: NetworkRetailerUpgradeRepository,
  ): RetailerUpgradeRepository

  /** The unread count belongs to the signed-in recipient, so it goes with the session. */
  @Binds
  @IntoSet
  abstract fun bindUnreadSessionScoped(impl: UnreadStore): SessionScopedStore
}