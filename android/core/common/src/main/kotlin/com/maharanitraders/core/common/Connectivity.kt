package com.maharanitraders.core.common

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Connectivity awareness for offline/retry UI.
 *
 * Being "online" is a HINT for the UI only: it never gates a server call, and a
 * `true` value never means a mutation succeeded. Every money/stock action still
 * requires a real server response (see [OfflinePolicy]).
 */
interface NetworkMonitor {
  val isOnline: Flow<Boolean>
}

@Singleton
class AndroidNetworkMonitor @Inject constructor(
  @ApplicationContext private val context: Context,
) : NetworkMonitor {

  override val isOnline: Flow<Boolean> = callbackFlow {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    if (manager == null) {
      trySend(true)
      awaitClose { }
      return@callbackFlow
    }

    fun currentlyOnline(): Boolean {
      val network: Network = manager.activeNetwork ?: return false
      val capabilities = manager.getNetworkCapabilities(network) ?: return false
      return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        trySend(currentlyOnline())
      }

      override fun onLost(network: Network) {
        trySend(currentlyOnline())
      }

      override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
        trySend(currentlyOnline())
      }
    }

    trySend(currentlyOnline())
    manager.registerDefaultNetworkCallback(callback)
    awaitClose { manager.unregisterNetworkCallback(callback) }
  }.distinctUntilChanged()
}
