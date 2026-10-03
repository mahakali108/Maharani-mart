package com.maharanitraders.app.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.maharanitraders.app.ui.SessionHomeScreen
import com.maharanitraders.app.ui.UnsupportedAccountScreen
import com.maharanitraders.core.designsystem.IsoDateDisplay
import com.maharanitraders.core.designsystem.components.MenuIcon
import com.maharanitraders.core.designsystem.components.UnavailableFeatureState
import com.maharanitraders.core.designsystem.labels.label
import com.maharanitraders.core.model.SessionSnapshot
import com.maharanitraders.core.model.UserRole
import com.maharanitraders.feature.catalog.ProductDetailViewModel
import com.maharanitraders.feature.catalog.ui.CatalogScreen
import com.maharanitraders.feature.catalog.ui.ProductDetailScreen
import com.maharanitraders.feature.catalog.ui.RetailerHomeScreen
import kotlinx.coroutines.launch

/** Test tags for the shell, used by Compose UI tests added in later phases. */
object ShellTags {
  const val DRAWER_CONTENT = "shell_drawer"
  const val OPEN_DRAWER = "shell_open_drawer"
  const val SIGN_OUT = "shell_sign_out"
  const val OPEN_ACCOUNT = "shell_open_account"
  const val ACCOUNT_SHEET = "shell_account_sheet"
  const val BRAND = "shell_brand"
}

/**
 * The filters the home screen hands to the catalogue when the shopper searches
 * or taps a category.
 *
 * A value object rather than navigation arguments on purpose: the catalogue
 * destination keeps one stable route, so drawer selection state and back-stack
 * identity do not depend on what the shopper last typed.
 */
data class CatalogRequest(
  val search: String = "",
  val categoryId: String? = null,
)

/**
 * The signed-in shell: one drawer, one navigation graph, role-shaped.
 *
 * Every drawer entry comes from [MaharaniRouter], so the drawer and the graph can
 * never disagree with the server's policy. Destinations that belong to a later
 * migration phase render [UnavailableFeatureState] — this build has no fake cart,
 * no placeholder order flow and no simulated coins.
 *
 * Role awareness is preserved exactly as it was: a retailer lands on the
 * shopping home (Phase D), every other role keeps the session home that shows
 * the account and the workspaces the server allowed. Nothing here decides a
 * permission — that stays with the server, and every protected API call is
 * re-checked there.
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
  val isHome = currentRoute == MaharaniRoutes.HOME
  val showAccount = rememberSaveable { mutableStateOf(false) }
  var catalogRequest by remember { mutableStateOf(CatalogRequest()) }

  // A retailer gets the shopping home; everyone else keeps the session home.
  // The role comes from the SERVER-verified snapshot, not from anything the
  // shopper can influence.
  val retailerHome = snapshot.role == UserRole.RETAILER &&
    routing.destinations.any { it.route == MaharaniRoutes.CATALOG }

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
          title = {
            if (isHome) {
              BrandLockup()
            } else {
              Text("Maharani Traders — $currentLabel")
            }
          },
          navigationIcon = {
            IconButton(
              onClick = { scope.launch { drawerState.open() } },
              modifier = Modifier.testTag(ShellTags.OPEN_DRAWER),
            ) {
              MenuIcon()
            }
          },
          // Account, not cart: cart and checkout are a later phase, and a cart
          // button that cannot check out would be a promise the app cannot keep.
          actions = {
            TextButton(
              onClick = { showAccount.value = true },
              modifier = Modifier.testTag(ShellTags.OPEN_ACCOUNT),
            ) {
              Text("Account", color = MaterialTheme.colorScheme.onPrimary)
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
              retailerHome = retailerHome,
              catalogRequest = catalogRequest,
              onOpenCatalog = { request ->
                catalogRequest = request
                navController.navigate(MaharaniRoutes.CATALOG) {
                  launchSingleTop = true
                  restoreState = true
                  popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                }
              },
              onOpenProduct = { productId ->
                navController.navigate(MaharaniRoutes.productDetail(productId))
              },
              onSignOut = onSignOut,
            )
          }
        }

        // Product detail sits outside the drawer catalog: it is reachable from
        // the home rail and the catalogue grid, and it is never a drawer entry.
        composable(
          route = MaharaniRoutes.PRODUCT_DETAIL,
          arguments = listOf(
            navArgument(ProductDetailViewModel.ARG_PRODUCT_ID) { type = NavType.StringType },
          ),
        ) {
          ProductDetailScreen(onBack = { navController.popBackStack() })
        }
      }
    }
  }

  if (showAccount.value) {
    AccountDialog(snapshot = snapshot, onClose = { showAccount.value = false }, onSignOut = {
      showAccount.value = false
      onSignOut()
    })
  }
}

/**
 * The brand lockup shown on the home app bar.
 *
 * A white mark on the brand red, exactly the launcher's own colour pairing — no
 * bitmap asset is needed, and nothing about it can disagree with the theme.
 */
@Composable
private fun BrandLockup(modifier: Modifier = Modifier) {
  Row(
    modifier = modifier
      .padding(vertical = 6.dp)
      .testTag(ShellTags.BRAND),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Box(
      modifier = Modifier
        .size(32.dp)
        .clip(RoundedCornerShape(9.dp))
        .background(MaterialTheme.colorScheme.onPrimary),
      contentAlignment = Alignment.Center,
    ) {
      Text(
        text = "M",
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
      )
    }
    Column {
      Text(text = "Maharani Traders", style = MaterialTheme.typography.titleMedium)
      Text(
        text = "Wholesale for retailers",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f),
      )
    }
  }
}

/**
 * The signed-in account, in one dialog.
 *
 * Every line is a fact from the server-verified session: the account name, the
 * role the server assigned, the shop's approval status and the access expiry.
 * Sign out is here as well as in the drawer, because a shopper who opened the
 * account action expects to find it.
 */
@Composable
private fun AccountDialog(
  snapshot: SessionSnapshot,
  onClose: () -> Unit,
  onSignOut: () -> Unit,
) {
  AlertDialog(
    onDismissRequest = onClose,
    modifier = Modifier.testTag(ShellTags.ACCOUNT_SHEET),
    title = { Text("Your account") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
          text = snapshot.user.fullName ?: snapshot.user.email ?: "Signed in",
          style = MaterialTheme.typography.titleMedium,
        )
        snapshot.user.email?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        snapshot.user.phone?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        Text(
          text = snapshot.role.label(),
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.primary,
        )
        snapshot.retailer?.let { retailer ->
          Text(
            text = (retailer.shopName ?: "Your shop") + " · " + retailer.status.label(),
            style = MaterialTheme.typography.bodyMedium,
          )
        }
        snapshot.access?.let { access ->
          Text(
            text = IsoDateDisplay.formatDate(access.expiresAtIso)
              ?.let { "Access valid until $it (UTC)" }
              ?: "Access period: ${access.status}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
    },
    confirmButton = {
      TextButton(onClick = onSignOut, modifier = Modifier.testTag(ShellTags.SIGN_OUT)) {
        Text("Sign out")
      }
    },
    dismissButton = { TextButton(onClick = onClose) { Text("Close") } },
  )
}

@Composable
private fun DestinationSurface(
  destination: MaharaniDestination,
  snapshot: SessionSnapshot,
  retailerHome: Boolean,
  catalogRequest: CatalogRequest,
  onOpenCatalog: (CatalogRequest) -> Unit,
  onOpenProduct: (String) -> Unit,
  onSignOut: () -> Unit,
) {
  when (destination.route) {
    MaharaniRoutes.HOME -> if (retailerHome) {
      RetailerHomeScreen(
        onOpenCatalog = { search, categoryId -> onOpenCatalog(CatalogRequest(search, categoryId)) },
        onOpenProduct = onOpenProduct,
      )
    } else {
      SessionHomeScreen(snapshot = snapshot, onSignOut = onSignOut)
    }

    MaharaniRoutes.CATALOG -> CatalogScreen(
      initialSearch = catalogRequest.search,
      initialCategoryId = catalogRequest.categoryId,
      onOpenProduct = onOpenProduct,
    )

    else -> {
      val phase = destination.phase
      if (phase == null) {
        // A destination with no phase and no screen of its own is a
        // configuration error, not a place to invent content.
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
