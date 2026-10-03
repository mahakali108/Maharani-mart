package com.maharanitraders.app.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.maharanitraders.app.ui.AccountScreen
import com.maharanitraders.app.ui.SessionHomeScreen
import com.maharanitraders.app.ui.UnsupportedAccountScreen
import com.maharanitraders.core.designsystem.IsoDateDisplay
import com.maharanitraders.core.designsystem.components.AccountGlyph
import com.maharanitraders.core.designsystem.components.BackGlyph
import com.maharanitraders.core.designsystem.components.CartGlyph
import com.maharanitraders.core.designsystem.components.CategoryGlyph
import com.maharanitraders.core.designsystem.components.CrownGlyph
import com.maharanitraders.core.designsystem.components.HomeGlyph
import com.maharanitraders.core.designsystem.components.MaharaniSearchBar
import com.maharanitraders.core.designsystem.components.MenuGlyph
import com.maharanitraders.core.designsystem.components.OrdersGlyph
import com.maharanitraders.core.designsystem.components.UnavailableFeatureState
import com.maharanitraders.core.designsystem.labels.label
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.SessionSnapshot
import com.maharanitraders.core.model.UserRole
import com.maharanitraders.feature.catalog.ProductDetailViewModel
import com.maharanitraders.feature.catalog.ui.CatalogScreen
import com.maharanitraders.feature.catalog.ui.CategoriesScreen
import com.maharanitraders.feature.catalog.ui.HomeScreenTags
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
  const val BOTTOM_BAR = "shell_bottom_bar"
}

/**
 * The filters the home screen hands to the catalogue when the shopper searches
 * or taps a category / brand.
 *
 * A value object rather than navigation arguments on purpose: the catalogue
 * destination keeps one stable route, so bottom-bar selection state and
 * back-stack identity do not depend on what the shopper last typed.
 */
data class CatalogRequest(
  val search: String = "",
  val categoryId: String? = null,
  val brandId: String? = null,
  val brandLabel: String? = null,
)

/** The five tabs of the shopping bottom bar, in drawer order. */
private val BOTTOM_NAV_ROUTES = listOf(
  MaharaniRoutes.HOME,
  MaharaniRoutes.CATEGORIES,
  MaharaniRoutes.CART,
  MaharaniRoutes.ORDERS,
  MaharaniRoutes.ACCOUNT,
)

/**
 * The signed-in shell: one drawer, one bottom bar, one navigation graph, all
 * role-shaped.
 *
 * Every entry comes from [MaharaniRouter], so the bar, the drawer and the graph
 * can never disagree with the server's policy. Destinations that belong to a
 * later migration phase render [UnavailableFeatureState] — this build has no
 * fake cart, no placeholder order flow and no simulated coins, and the bar shows
 * them as honest "planned" tabs rather than hiding them, because a retailer
 * expects a cart and an order history to exist in a shopping app.
 *
 * Role awareness is preserved exactly as before: a retailer lands on the
 * shopping home, every other role keeps the session home that shows the account
 * and the workspaces the server allowed. Nothing here decides a permission —
 * that stays with the server, and every protected API call is re-checked there.
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
  val showAccount = rememberSaveable { mutableStateOf(false) }
  var catalogRequest by remember { mutableStateOf(CatalogRequest()) }
  var homeSearch by rememberSaveable { mutableStateOf("") }

  // A retailer gets the shopping home; everyone else keeps the session home.
  // The role comes from the SERVER-verified snapshot, not from anything the
  // shopper can influence.
  val retailerHome = snapshot.role == UserRole.RETAILER &&
    routing.destinations.any { it.route == MaharaniRoutes.CATALOG }

  val bottomItems = routing.destinations.filter { it.route in BOTTOM_NAV_ROUTES }
  val drawerItems = routing.destinations.filter { it.route !in BOTTOM_NAV_ROUTES }
  val showBottomBar = currentRoute in BOTTOM_NAV_ROUTES
  val currentLabel = routing.destinations.firstOrNull { it.route == currentRoute }?.label
    ?: routing.start.label

  fun openDrawer() {
    scope.launch { drawerState.open() }
  }

  fun openCatalog(request: CatalogRequest) {
    catalogRequest = request
    navController.navigate(MaharaniRoutes.CATALOG) {
      launchSingleTop = true
      restoreState = true
      popUpTo(navController.graph.findStartDestination().id) { saveState = true }
    }
  }

  fun selectTab(destination: MaharaniDestination) {
    if (destination.route == currentRoute) return
    navController.navigate(destination.route) {
      // One entry per destination, state preserved across switches.
      launchSingleTop = true
      restoreState = true
      popUpTo(navController.graph.findStartDestination().id) { saveState = true }
    }
  }

  ModalNavigationDrawer(
    drawerState = drawerState,
    drawerContent = {
      ModalDrawerSheet(modifier = Modifier.testTag(ShellTags.DRAWER_CONTENT)) {
        DrawerContent(
          snapshot = snapshot,
          destinations = drawerItems,
          currentRoute = currentRoute,
          onSelect = { destination ->
            scope.launch { drawerState.close() }
            selectTab(destination)
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
        when {
          currentRoute == MaharaniRoutes.HOME && retailerHome -> RetailerHomeTopBar(
            snapshot = snapshot,
            search = homeSearch,
            onSearchChange = { homeSearch = it },
            // `MaharaniSearchBar.onSubmit` carries no argument: the shell owns the
            // field's text, so submit reads the state it already holds.
            onSearchSubmit = { openCatalog(CatalogRequest(search = homeSearch.trim())) },
            onOpenDrawer = ::openDrawer,
            onOpenAccount = { showAccount.value = true },
          )

          currentRoute == MaharaniRoutes.PRODUCT_DETAIL -> TopAppBar(
            title = { Text("Product details") },
            navigationIcon = {
              IconButton(onClick = { navController.popBackStack() }) {
                BackGlyph(modifier = Modifier.size(22.dp))
              }
            },
            colors = TopAppBarDefaults.topAppBarColors(
              containerColor = MaterialTheme.colorScheme.surface,
              titleContentColor = MaterialTheme.colorScheme.onSurface,
              navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
            ),
          )

          else -> TopAppBar(
            title = {
              if (currentRoute == MaharaniRoutes.HOME) {
                BrandLockup()
              } else {
                Text(currentLabel, maxLines = 1, overflow = TextOverflow.Ellipsis)
              }
            },
            navigationIcon = {
              IconButton(
                onClick = ::openDrawer,
                modifier = Modifier.testTag(ShellTags.OPEN_DRAWER),
              ) {
                MenuGlyph(modifier = Modifier.size(22.dp))
              }
            },
            actions = {
              if (currentRoute != MaharaniRoutes.ACCOUNT) {
                IconButton(
                  onClick = { showAccount.value = true },
                  modifier = Modifier.testTag(ShellTags.OPEN_ACCOUNT),
                ) {
                  AccountGlyph(modifier = Modifier.size(22.dp))
                }
              }
            },
            colors = TopAppBarDefaults.topAppBarColors(
              containerColor = MaterialTheme.colorScheme.primary,
              titleContentColor = MaterialTheme.colorScheme.onPrimary,
              navigationIconContentColor = MaterialTheme.colorScheme.onPrimary,
              actionIconContentColor = MaterialTheme.colorScheme.onPrimary,
            ),
          )
        }
      },
      bottomBar = {
        if (showBottomBar && bottomItems.isNotEmpty()) {
          NavigationBar(
            modifier = Modifier.testTag(ShellTags.BOTTOM_BAR),
            containerColor = MaterialTheme.colorScheme.surface,
          ) {
            bottomItems.forEach { destination ->
              NavigationBarItem(
                selected = destination.route == currentRoute,
                onClick = { selectTab(destination) },
                icon = { BottomBarIcon(route = destination.route) },
                label = {
                  Text(
                    text = destination.label,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                  )
                },
                alwaysShowLabel = true,
                colors = NavigationBarItemDefaults.colors(
                  selectedIconColor = MaterialTheme.colorScheme.primary,
                  selectedTextColor = MaterialTheme.colorScheme.primary,
                  indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                  unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                  unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
              )
            }
          }
        }
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
              onOpenCatalog = ::openCatalog,
              onOpenCategories = {
                navController.navigate(MaharaniRoutes.CATEGORIES) {
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
 * The shopping app bar: brand, the shop the server verified, the account entry
 * and the always-visible search field — the reference UX's signature layout,
 * drawn in Maharani blue with the crown mark.
 *
 * The bar extends behind the status bar (edge-to-edge) and pads its own
 * content, so the blue is continuous from the top of the window down to the
 * search field.
 */
@Composable
private fun RetailerHomeTopBar(
  snapshot: SessionSnapshot,
  search: String,
  onSearchChange: (String) -> Unit,
  onSearchSubmit: () -> Unit,
  onOpenDrawer: () -> Unit,
  onOpenAccount: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val tokens = MaharaniThemeTokens.colors

  Surface(modifier = modifier.fillMaxWidth()) {
    Column(
      modifier = Modifier
        .background(Brush.verticalGradient(listOf(tokens.appBarStart, tokens.appBarEnd)))
        .windowInsetsPadding(
          WindowInsets.statusBars.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal),
        )
        .padding(
          horizontal = MaharaniDimens.pageGutter,
          vertical = MaharaniDimens.spaceSm,
        ),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
      ) {
        IconButton(onClick = onOpenDrawer, modifier = Modifier.testTag(ShellTags.OPEN_DRAWER)) {
          MenuGlyph(modifier = Modifier.size(22.dp), tint = tokens.onAppBar)
        }

        Box(
          modifier = Modifier
            .size(34.dp)
            .background(
              color = tokens.onAppBar.copy(alpha = 0.16f),
              shape = RoundedCornerShape(10.dp),
            ),
          contentAlignment = Alignment.Center,
        ) {
          CrownGlyph(modifier = Modifier.size(22.dp), tint = tokens.onAppBar)
        }

        Column(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
        ) {
          Text(
            text = "Maharani Traders",
            style = MaterialTheme.typography.titleMedium,
            color = tokens.onAppBar,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.testTag(ShellTags.BRAND),
          )
          Text(
            text = snapshot.retailer?.shopName ?: "Wholesale for retailers",
            style = MaterialTheme.typography.labelSmall,
            color = tokens.onAppBarMuted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }

        IconButton(
          onClick = onOpenAccount,
          modifier = Modifier.testTag(ShellTags.OPEN_ACCOUNT),
        ) {
          AccountGlyph(modifier = Modifier.size(22.dp), tint = tokens.onAppBar)
        }
      }

      MaharaniSearchBar(
        value = search,
        onValueChange = onSearchChange,
        onSubmit = onSearchSubmit,
        onBar = true,
        testTag = HomeScreenTags.SEARCH_FIELD,
      )
    }
  }
}

@Composable
private fun BottomBarIcon(route: String, modifier: Modifier = Modifier) {
  val iconModifier = modifier.size(24.dp)
  when (route) {
    MaharaniRoutes.HOME -> HomeGlyph(modifier = iconModifier)
    MaharaniRoutes.CATEGORIES -> CategoryGlyph(modifier = iconModifier)
    MaharaniRoutes.CART -> CartGlyph(modifier = iconModifier)
    MaharaniRoutes.ORDERS -> OrdersGlyph(modifier = iconModifier)
    MaharaniRoutes.ACCOUNT -> AccountGlyph(modifier = iconModifier)
    else -> HomeGlyph(modifier = iconModifier)
  }
}

/**
 * The brand lockup shown on non-retailer home app bars: a white mark on the
 * primary colour — no bitmap asset is needed, and nothing about it can disagree
 * with the theme.
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
    CrownGlyph(modifier = Modifier.size(26.dp))
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
 * Sign out is here as well as in the drawer and the account tab, because a
 * shopper who opened the account action expects to find it.
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
  onOpenCategories: () -> Unit,
  onOpenProduct: (String) -> Unit,
  onSignOut: () -> Unit,
) {
  when (destination.route) {
    MaharaniRoutes.HOME -> if (retailerHome) {
      RetailerHomeScreen(
        onOpenCatalog = { search, categoryId, brandId, brandLabel ->
          onOpenCatalog(CatalogRequest(search, categoryId, brandId, brandLabel))
        },
        onOpenProduct = onOpenProduct,
        onOpenCategories = onOpenCategories,
      )
    } else {
      SessionHomeScreen(snapshot = snapshot, onSignOut = onSignOut)
    }

    MaharaniRoutes.CATALOG -> CatalogScreen(
      initialSearch = catalogRequest.search,
      initialCategoryId = catalogRequest.categoryId,
      initialBrandId = catalogRequest.brandId,
      initialBrandLabel = catalogRequest.brandLabel,
      onOpenProduct = onOpenProduct,
    )

    MaharaniRoutes.CATEGORIES -> CategoriesScreen(
      onOpenCategory = { categoryId -> onOpenCatalog(CatalogRequest(categoryId = categoryId)) },
      onOpenBrand = { brand ->
        onOpenCatalog(CatalogRequest(brandId = brand.id, brandLabel = brand.name))
      },
    )

    MaharaniRoutes.ACCOUNT -> AccountScreen(
      snapshot = snapshot,
      onSignOut = onSignOut,
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
    Row(
      modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      CrownGlyph(
        modifier = Modifier.size(26.dp),
        tint = MaterialTheme.colorScheme.primary,
      )
      Text(
        text = "Maharani Traders",
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.primary,
      )
    }
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

    if (destinations.isEmpty()) {
      Text(
        text = "Everything this account can open is on the bottom bar.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
      )
    }

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
