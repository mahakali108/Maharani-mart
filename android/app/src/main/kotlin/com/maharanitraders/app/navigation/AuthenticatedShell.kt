package com.maharanitraders.app.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.maharanitraders.app.ui.SessionHomeScreen
import com.maharanitraders.app.ui.UnsupportedAccountScreen
import com.maharanitraders.core.designsystem.components.MenuIcon
import com.maharanitraders.core.designsystem.components.UnavailableFeatureState
import com.maharanitraders.core.designsystem.labels.label
import com.maharanitraders.core.model.SessionSnapshot
import kotlinx.coroutines.launch

/** Test tags for the shell, used by Compose UI tests added in later phases. */
object ShellTags {
  const val DRAWER_CONTENT = "shell_drawer"
  const val OPEN_DRAWER = "shell_open_drawer"
  const val SIGN_OUT = "shell_sign_out"
}

/**
 * The signed-in shell: one drawer, one navigation graph, role-shaped.
 *
 * Every route in the graph comes from [MaharaniRouter], so the drawer and the
 * graph can never disagree with the server's policy. Destinations that belong
 * to a later migration phase render [UnavailableFeatureState] — this build has
 * no mock catalog, no fake cart and no placeholder order flow.
 */
@Composable
fun AuthenticatedShell(
  snapshot: SessionSnapshot,
  onSignOut: () -> Unit,
) {
  when (val routing = remember(snapshot) { MaharaniRouter.resolveSession(snapshot) }) {
    is SessionRouting.Unsupported -> UnsupportedAccountScreen(routing.reason, onSignOut)
    is SessionRouting.Ready -> RoutedShell(snapshot, routing, onSignOut)
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RoutedShell(
  snapshot: SessionSnapshot,
  routing: SessionRouting.Ready,
  onSignOut: () -> Unit,
) {
  val navController = rememberNavController()
  val drawerState = rememberDrawerState(DrawerValue.Closed)
  val scope = rememberCoroutineScope()
  val backStackEntry by navController.currentBackStackEntryAsState()
  val currentRoute = backStackEntry?.destination?.route ?: routing.start.route
  val currentLabel =
    routing.destinations.firstOrNull { it.route == currentRoute }?.label ?: routing.start.label

  ModalNavigationDrawer(
    drawerState = drawerState,
    drawerContent = {
      ModalDrawerSheet(modifier = Modifier.testTag(ShellTags.DRAWER_CONTENT)) {
        DrawerContent(
          snapshot = snapshot,
          destinations = routing.destinations,
          currentRoute = currentRoute,
          onSelect = { destination ->
            scope.launch { drawerState.close() }
            if (destination.route != currentRoute) {
              navController.navigate(destination.route) {
                // One entry per destination, state preserved across switches.
                launchSingleTop = true
                restoreState = true
                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
              }
            }
          },
          onSignOut = {
            scope.launch { drawerState.close() }
            onSignOut()
          },
        )
      }
    },
  ) {
    Scaffold(
      topBar = {
        TopAppBar(
          title = { Text("Maharani Traders — $currentLabel") },
          navigationIcon = {
            IconButton(
              onClick = { scope.launch { drawerState.open() } },
              modifier = Modifier.testTag(ShellTags.OPEN_DRAWER),
            ) {
              MenuIcon()
            }
          },
          colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.primary,
            titleContentColor = MaterialTheme.colorScheme.onPrimary,
            navigationIconContentColor = MaterialTheme.colorScheme.onPrimary,
          ),
        )
      },
    ) { padding ->
      NavHost(
        navController = navController,
        startDestination = routing.start.route,
        modifier = Modifier.padding(padding),
      ) {
        routing.destinations.forEach { destination ->
          composable(destination.route) {
            DestinationSurface(
              destination = destination,
              snapshot = snapshot,
              onSignOut = onSignOut,
            )
          }
        }
      }
    }
  }
}

@Composable
private fun DestinationSurface(
  destination: MaharaniDestination,
  snapshot: SessionSnapshot,
  onSignOut: () -> Unit,
) {
  val phase = destination.phase
  if (phase == null || destination.route == MaharaniRoutes.HOME) {
    SessionHomeScreen(snapshot = snapshot, onSignOut = onSignOut)
  } else {
    UnavailableFeatureState(
      title = destination.label,
      message = "${destination.summary} This screen is part of the planned native build; " +
        "the current web workspace remains the source of truth until then.",
      phaseLabel = "Planned · ${phase.label}",
    )
  }
}

@Composable
private fun DrawerContent(
  snapshot: SessionSnapshot,
  destinations: List<MaharaniDestination>,
  currentRoute: String,
  onSelect: (MaharaniDestination) -> Unit,
  onSignOut: () -> Unit,
) {
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .verticalScroll(rememberScrollState())
      .padding(vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(2.dp),
  ) {
    Text(
      text = "Maharani Traders",
      style = MaterialTheme.typography.titleLarge,
      color = MaterialTheme.colorScheme.primary,
      modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
    )
    Text(
      text = snapshot.user.fullName ?: snapshot.user.email ?: "Signed in",
      style = MaterialTheme.typography.bodyMedium,
      modifier = Modifier.padding(horizontal = 24.dp),
    )
    Text(
      text = snapshot.user.role.label(),
      style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
    )
    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

    destinations.forEach { destination ->
      NavigationDrawerItem(
        label = { Text(destination.label) },
        selected = destination.route == currentRoute,
        onClick = { onSelect(destination) },
        modifier = Modifier.padding(NavigationDrawerItemDefaults.ItemPadding),
      )
    }

    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
    NavigationDrawerItem(
      label = { Text("Sign out") },
      selected = false,
      onClick = onSignOut,
      modifier = Modifier
        .padding(NavigationDrawerItemDefaults.ItemPadding)
        .testTag(ShellTags.SIGN_OUT),
    )
  }
}
