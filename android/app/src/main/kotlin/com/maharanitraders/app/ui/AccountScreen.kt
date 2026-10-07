package com.maharanitraders.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.app.BuildConfig
import com.maharanitraders.app.navigation.MaharaniCatalog
import com.maharanitraders.app.navigation.MaharaniRoutes
import com.maharanitraders.core.designsystem.IsoDateDisplay
import com.maharanitraders.core.designsystem.components.ChevronRightGlyph
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.labels.label
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.SessionSnapshot
import com.maharanitraders.core.model.UserRole
import com.maharanitraders.core.model.Workspace

/** Test tags for the account surface. */
object AccountScreenTags {
  const val PROFILE = "account_profile"
  const val SHOP = "account_shop"
  const val ACCESS = "account_access"
  const val SIGN_OUT = "account_sign_out"
  const val ADDRESS_BOOK = "account_address_book"
  const val SHORTCUTS = "account_shortcuts"
  const val BUY_AGAIN = "account_buy_again"
  const val SECURITY = "account_security"
  const val HELP = "account_help"
}

/**
 * The Account tab: the verified session, presented as a profile, plus the
 * shortcuts to everything else this account owns.
 *
 * Nothing here is fetched again or invented — every line is the same
 * server-verified snapshot the shell was routed with: identity, role, shop
 * status, access period and the workspaces the server's policy grants. The
 * shortcuts open the REAL destinations that already exist (orders, favourites,
 * the coin wallet, coupons, notifications, quick order), so "Account" is a place
 * a shopkeeper can run their account from rather than a dead end. Sign out is
 * the real session controller's, and it clears the account's cached state.
 */
@Composable
fun AccountScreen(
  snapshot: SessionSnapshot,
  onSignOut: () -> Unit,
  modifier: Modifier = Modifier,
  /** Opens the delivery address book — a real screen over the addresses API. */
  onOpenAddresses: () -> Unit = {},
  /** Opens the order history tab. */
  onOpenOrders: () -> Unit = {},
  /** Opens another destination of this account, by route. */
  onOpenDestination: (String) -> Unit = {},
  /** The server-filtered routes in this shell; restricted shortcuts are hidden. */
  availableRoutes: Set<String>? = null,
) {
  LazyColumn(
    modifier = modifier
      .fillMaxWidth()
      .testTag(AccountScreenTags.PROFILE),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item { ProfileCard(snapshot = snapshot) }

    if (snapshot.retailer != null) {
      item { ShopCard(snapshot = snapshot) }
    }

    if (snapshot.access != null) {
      item { AccessCard(snapshot = snapshot) }
    }

    if (snapshot.retailer != null) {
      item {
        Surface(
          onClick = onOpenAddresses,
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          color = MaterialTheme.colorScheme.surface,
          tonalElevation = 1.dp,
          modifier = Modifier
            .fillMaxWidth()
            .testTag(AccountScreenTags.ADDRESS_BOOK),
        ) {
          Row(
            modifier = Modifier.padding(MaharaniDimens.spaceMd),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
          ) {
            Column(modifier = Modifier.weight(1f)) {
              Text(
                text = "Delivery addresses",
                style = MaterialTheme.typography.titleSmall,
              )
              Text(
                text = "Add, edit, delete or set the default address used at checkout.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
              )
            }
            Text(
              text = "Manage",
              style = MaterialTheme.typography.labelLarge,
              color = MaterialTheme.colorScheme.primary,
            )
          }
        }
      }
    }

    if (snapshot.role == UserRole.RETAILER) {
      item {
        AccountShortcutGroups(
          onOpenOrders = onOpenOrders,
          onOpenDestination = onOpenDestination,
          availableRoutes = availableRoutes,
        )
      }
    }

    item { WorkspacesCard(snapshot = snapshot) }

    item {
      Button(
        onClick = onSignOut,
        modifier = Modifier
          .fillMaxWidth()
          .testTag(AccountScreenTags.SIGN_OUT),
        colors = ButtonDefaults.buttonColors(
          containerColor = MaterialTheme.colorScheme.errorContainer,
          contentColor = MaterialTheme.colorScheme.onErrorContainer,
        ),
        shape = RoundedCornerShape(MaharaniDimens.radiusTile),
      ) {
        Text(
          text = "Sign out",
          style = MaterialTheme.typography.labelLarge,
          modifier = Modifier.padding(vertical = MaharaniDimens.spaceXs),
        )
      }
    }

    item {
      Text(
        text = "Maharani Traders for Android · version ${BuildConfig.VERSION_NAME}",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = MaharaniDimens.spaceMd),
      )
    }
  }
}

/**
 * The account's own shortcuts, in one card.
 *
 * Every row opens a destination the router already granted this account, so a
 * row that could not be opened is not drawn: the list is built from the same
 * server-described workspace/permission check the drawer uses, not from a
 * hardcoded wish list. Costs nothing to render (no request) — each destination
 * loads its own real data when it opens.
 */
/**
 * The account's destinations, grouped the way a shopkeeper looks for them.
 *
 * WHY GROUPS
 * A flat list of fourteen rows makes every action equally hard to find. The
 * groups below are the jobs a retailer actually has: buy things, look after
 * money, look after the account, get help. Within a group the order is
 * frequency, and every row still opens a destination the router already granted
 * this account — a row that could not be opened is not drawn, so the list is
 * never a wish list.
 *
 * Each destination loads its own real data when it opens. This screen issues no
 * request of its own.
 */
@Composable
private fun AccountShortcutGroups(
  onOpenOrders: () -> Unit,
  onOpenDestination: (String) -> Unit,
  availableRoutes: Set<String>?,
  modifier: Modifier = Modifier,
) {
  fun allowed(route: String): Boolean = availableRoutes == null || route in availableRoutes

  Column(
    modifier = modifier.testTag(AccountScreenTags.SHORTCUTS),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    AccountGroup(title = "My shopping", subtitle = "Order, reorder and restock") {
      if (allowed(MaharaniRoutes.ORDERS)) {
        ShortcutRow("My orders", "Track, reorder and download invoices", onOpenOrders)
      }
      if (allowed(MaharaniRoutes.BUY_AGAIN)) {
        ShortcutRow(
          label = "Buy again",
          detail = "What your shop orders most, at today's prices",
          onClick = { onOpenDestination(MaharaniRoutes.BUY_AGAIN) },
          tag = AccountScreenTags.BUY_AGAIN,
        )
      }
      if (allowed(MaharaniRoutes.QUICK_ORDER)) {
        ShortcutRow(
          label = "Quick order",
          detail = "Restock a known list in seconds",
          onClick = { onOpenDestination(MaharaniRoutes.QUICK_ORDER) },
        )
      }
      if (allowed(MaharaniRoutes.FAVORITES)) {
        ShortcutRow(
          label = "Favourites",
          detail = "The products you saved",
          onClick = { onOpenDestination(MaharaniRoutes.FAVORITES) },
        )
      }
      if (allowed(MaharaniRoutes.SAVED_CARTS)) {
        ShortcutRow(
          label = "Saved carts",
          detail = "Keep and restore restock lists",
          onClick = { onOpenDestination(MaharaniRoutes.SAVED_CARTS) },
        )
      }
      if (allowed(MaharaniRoutes.REPORTS)) {
        ShortcutRow(
          label = "Purchase reports",
          detail = "Weekly, monthly and CSV statements",
          onClick = { onOpenDestination(MaharaniRoutes.REPORTS) },
        )
      }
    }

    AccountGroup(title = "Money & benefits", subtitle = "Coins, offers and schemes") {
      if (allowed(MaharaniRoutes.COINS)) {
        ShortcutRow(
          label = "Maharani Coins",
          detail = "Balance and ledger",
          onClick = { onOpenDestination(MaharaniRoutes.COINS) },
        )
      }
      if (allowed(MaharaniRoutes.COUPONS)) {
        ShortcutRow(
          label = "Coupons and offers",
          detail = "Apply a code at checkout",
          onClick = { onOpenDestination(MaharaniRoutes.COUPONS) },
        )
      }
      if (allowed(MaharaniRoutes.SCHEMES)) {
        ShortcutRow(
          label = "Active schemes",
          detail = "Live schemes for your shop",
          onClick = { onOpenDestination(MaharaniRoutes.SCHEMES) },
        )
      }
    }

    AccountGroup(title = "Account", subtitle = "Your details, addresses and security") {
      if (allowed(MaharaniRoutes.PROFILE)) {
        ShortcutRow(
          label = "Shop profile",
          detail = "Edit shop and contact details",
          onClick = { onOpenDestination(MaharaniRoutes.PROFILE) },
        )
      }
      if (allowed(MaharaniRoutes.NOTIFICATIONS)) {
        ShortcutRow(
          label = "Notifications",
          detail = "Order and account updates",
          onClick = { onOpenDestination(MaharaniRoutes.NOTIFICATIONS) },
        )
      }
      if (allowed(MaharaniRoutes.NOTIFICATION_PREFERENCES)) {
        ShortcutRow(
          label = "Notification settings",
          detail = "Choose in-app update categories",
          onClick = { onOpenDestination(MaharaniRoutes.NOTIFICATION_PREFERENCES) },
        )
      }
      if (allowed(MaharaniRoutes.SECURITY)) {
        ShortcutRow(
          label = "Security & privacy",
          detail = "Password, sessions and data requests",
          onClick = { onOpenDestination(MaharaniRoutes.SECURITY) },
          tag = AccountScreenTags.SECURITY,
        )
      }
    }

    AccountGroup(title = "Help", subtitle = "Talk to us, or read the answers") {
      if (allowed(MaharaniRoutes.SUPPORT)) {
        ShortcutRow(
          label = "Support tickets",
          detail = "Private conversations with support",
          onClick = { onOpenDestination(MaharaniRoutes.SUPPORT) },
        )
      }
      if (allowed(MaharaniRoutes.HELP)) {
        ShortcutRow(
          label = "Help centre",
          detail = "Support contacts and help",
          onClick = { onOpenDestination(MaharaniRoutes.HELP) },
          tag = AccountScreenTags.HELP,
        )
      }
    }
  }
}

/** One titled group of account rows. */
@Composable
private fun AccountGroup(
  title: String,
  subtitle: String,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  AccountCard(modifier = modifier) {
    Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
      SectionHeader(title = title, subtitle = subtitle)
      content()
    }
  }
}

@Composable
private fun ShortcutRow(
  label: String,
  detail: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  tag: String? = null,
) {
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    modifier = modifier
      .fillMaxWidth()
      .heightIn(min = MaharaniDimens.touchTarget)
      .then(if (tag != null) Modifier.testTag(tag) else Modifier),
  ) {
    Row(
      modifier = Modifier.padding(
        horizontal = MaharaniDimens.spaceMd,
        vertical = MaharaniDimens.spaceSm,
      ),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Column(modifier = Modifier.weight(1f)) {
        Text(
          text = label,
          style = MaterialTheme.typography.titleSmall,
          color = MaterialTheme.colorScheme.onSurface,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Text(
          text = detail,
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
      ChevronRightGlyph(
        modifier = Modifier.size(18.dp),
        tint = MaterialTheme.colorScheme.primary,
      )
    }
  }
}

@Composable
private fun ProfileCard(snapshot: SessionSnapshot, modifier: Modifier = Modifier) {
  val displayName = snapshot.user.fullName ?: snapshot.user.email ?: "Signed in"
  AccountCard(modifier = modifier) {
    Row(
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      Box(
        modifier = Modifier
          .size(56.dp)
          .clip(CircleShape)
          .background(MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
      ) {
        Text(
          text = initialsOf(displayName),
          style = MaterialTheme.typography.headlineSmall,
          color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
      }
      Column(
        modifier = Modifier.weight(1f),
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
      ) {
        Text(
          text = displayName,
          style = MaterialTheme.typography.titleMedium,
          color = MaterialTheme.colorScheme.onSurface,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
        snapshot.user.email?.let { email ->
          Text(
            text = email,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
        snapshot.user.phone?.let { phone ->
          Text(
            text = phone,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
          )
        }
      }
      Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shape = RoundedCornerShape(MaharaniDimens.radiusPill),
      ) {
        Text(
          text = snapshot.role.label(),
          style = MaterialTheme.typography.labelSmall,
          modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
        )
      }
    }
  }
}

@Composable
private fun ShopCard(snapshot: SessionSnapshot, modifier: Modifier = Modifier) {
  val retailer = snapshot.retailer ?: return
  AccountCard(modifier = modifier.testTag(AccountScreenTags.SHOP)) {
    Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
      SectionHeader(title = "Your shop")
      FactRow(label = "Shop name", value = retailer.shopName ?: "Not set")
      FactRow(label = "Approval", value = retailer.status.label())
    }
  }
}

@Composable
private fun AccessCard(snapshot: SessionSnapshot, modifier: Modifier = Modifier) {
  val access = snapshot.access ?: return
  val expiry = IsoDateDisplay.formatDate(access.expiresAtIso)
  AccountCard(modifier = modifier.testTag(AccountScreenTags.ACCESS)) {
    Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
      SectionHeader(title = "Access period")
      FactRow(label = "Status", value = access.status)
      FactRow(label = "Valid until", value = expiry?.let { "$it (UTC)" } ?: "No expiry on record")
    }
  }
}

@Composable
private fun WorkspacesCard(snapshot: SessionSnapshot, modifier: Modifier = Modifier) {
  val workspaces = snapshot.navigation.workspaces
  AccountCard(modifier = modifier) {
    Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
      SectionHeader(
        title = "Workspaces",
        subtitle = "Granted by the server for this account",
      )
      if (workspaces.isEmpty()) {
        Text(
          text = "No workspace granted.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      } else {
        workspaces.forEach { workspace: Workspace ->
          val destination = MaharaniCatalog.destinations.firstOrNull { it.workspace == workspace }
          FactRow(
            label = workspace.label(),
            value = destination?.summary ?: "Available in the web workspace.",
          )
        }
      }
    }
  }
}

@Composable
private fun AccountCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = MaharaniDimens.cardElevation,
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceLg),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
    ) { content() }
  }
}

@Composable
private fun FactRow(label: String, value: String, modifier: Modifier = Modifier) {
  Column(modifier = modifier.fillMaxWidth()) {
    Text(
      text = label,
      style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Text(
      text = value,
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurface,
    )
  }
}

/** "Gupta Kirana Store" → "GK"; falls back to the first two characters. */
private fun initialsOf(name: String): String {
  val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
  val initials = parts.mapNotNull { it.firstOrNull()?.uppercaseChar() }.take(2).joinToString("")
  return initials.ifEmpty { name.take(2).uppercase() }
}
