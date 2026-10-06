package com.maharanitraders.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.maharanitraders.app.navigation.MaharaniRoutes
import com.maharanitraders.core.designsystem.components.ChevronRightGlyph
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.theme.MaharaniDimens

/** Test tags for the help centre surface. */
object HelpScreenTags {
  const val SCREEN = "help_screen"
  const val TITLE = "help_title"
  const val SHORTCUTS = "help_shortcuts"
  const val FAQ = "help_faq"
  const val CONTACT = "help_contact"
}

/**
 * The retailer help centre, natively.
 *
 * Static content mirroring the web help page (`app/retailer/help/page.tsx`):
 * the same FAQs, word for word in meaning, and the same honest contact note.
 * Nothing here is fetched, and nothing is invented — in particular the screen
 * does NOT display a support phone number, because the app's API does not
 * expose one (the website reads a server environment variable). The shortcuts
 * only list destinations the router granted this account, so a retailer sees
 * order/coin/catalogue shortcuts and a non-retailer account sees none.
 */
@Composable
fun HelpScreen(
  /** Routes the server's policy granted this account — the only shortcuts shown. */
  availableRoutes: Set<String>,
  onOpenDestination: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyColumn(
    modifier = modifier
      .fillMaxWidth()
      .testTag(HelpScreenTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(modifier = Modifier.padding(vertical = MaharaniDimens.spaceXs)) {
        Text(
          text = "Retailer support",
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.primary,
        )
        Text(
          text = "Help centre",
          style = MaterialTheme.typography.headlineSmall,
          modifier = Modifier.testTag(HelpScreenTags.TITLE),
        )
        Text(
          text = "Get help with orders, coins, products and delivery — without leaving Maharani Traders.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.padding(top = MaharaniDimens.spaceXxs),
        )
      }
    }

    val shortcuts = HELP_SHORTCUTS.filter { it.route in availableRoutes }
    if (shortcuts.isNotEmpty()) {
      item {
        Surface(
          shape = RoundedCornerShape(MaharaniDimens.radiusCard),
          color = MaterialTheme.colorScheme.surface,
          shadowElevation = MaharaniDimens.cardElevation,
          modifier = Modifier
            .fillMaxWidth()
            .testTag(HelpScreenTags.SHORTCUTS),
        ) {
          Column(
            modifier = Modifier.padding(MaharaniDimens.spaceLg),
            verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
          ) {
            SectionHeader(title = "Where to look first")
            shortcuts.forEach { shortcut ->
              HelpShortcutRow(
                title = shortcut.title,
                detail = shortcut.detail,
                onClick = { onOpenDestination(shortcut.route) },
              )
            }
          }
        }
      }
    }

    item {
      Text(
        text = "Frequently asked questions",
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(top = MaharaniDimens.spaceXs),
      )
    }

    items(HELP_FAQ) { entry ->
      Surface(
        shape = RoundedCornerShape(MaharaniDimens.radiusCard),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = MaharaniDimens.cardElevation,
        modifier = Modifier
          .fillMaxWidth()
          .testTag(HelpScreenTags.FAQ),
      ) {
        Column(modifier = Modifier.padding(MaharaniDimens.spaceLg)) {
          Text(
            text = entry.question,
            style = MaterialTheme.typography.titleSmall,
          )
          Text(
            text = entry.answer,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = MaharaniDimens.spaceXs),
          )
        }
      }
    }

    item {
      Surface(
        shape = RoundedCornerShape(MaharaniDimens.radiusCard),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier
          .fillMaxWidth()
          .testTag(HelpScreenTags.CONTACT),
      ) {
        Column(modifier = Modifier.padding(MaharaniDimens.spaceLg)) {
          Text(
            text = "Contact your distributor",
            style = MaterialTheme.typography.titleSmall,
          )
          Text(
            text = "Support is handled by your assigned Maharani Traders distributor. The app's " +
              "API does not publish a support phone number — ask your distributor for the shop " +
              "helpline, or raise the issue with your next order's delivery person.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = MaharaniDimens.spaceXs),
          )
        }
      }
    }
  }
}

private data class HelpShortcut(val route: String, val title: String, val detail: String)

private data class HelpFaq(val question: String, val answer: String)

/**
 * Shortcuts mirror the web help page's topic cards, but only for destinations
 * this account may open — the router's granted set is the source of truth.
 */
private val HELP_SHORTCUTS = listOf(
  HelpShortcut(
    route = MaharaniRoutes.ORDERS,
    title = "Order issue",
    detail = "Track, invoice, reorder or review a placed order.",
  ),
  HelpShortcut(
    route = MaharaniRoutes.COINS,
    title = "Coins issue",
    detail = "Review your coin balance and full coin history.",
  ),
  HelpShortcut(
    route = MaharaniRoutes.CATALOG,
    title = "Product issue",
    detail = "Check pack size, GST or the current wholesale price.",
  ),
)

/** Same answers as the web help page — pricing, MOQ, coins, returns, invoices. */
private val HELP_FAQ = listOf(
  HelpFaq(
    question = "How are wholesale prices calculated?",
    answer = "Maharani Traders applies your retailer or area price on the server. The price you " +
      "see is a preview — checkout recalculates it and never trusts an amount sent by the app.",
  ),
  HelpFaq(
    question = "Why can't I add less than the MOQ?",
    answer = "Each pack has a minimum order quantity. The cart and checkout both re-check MOQ on " +
      "the server before an order is created.",
  ),
  HelpFaq(
    question = "How do coins work?",
    answer = "Coins are your shop balance — 1 coin = ₹1. Your distributor adds coins to your " +
      "account, and at checkout the server applies as many coins as your balance covers. Whatever " +
      "is left is payable on delivery. The balance, coins used and remaining payable are shown " +
      "before you place the order and re-checked on the server.",
  ),
  HelpFaq(
    question = "Can I cancel or return an order?",
    answer = "Pending orders can be cancelled and delivered orders can request a return on the " +
      "website. Both actions are checked against the real order status on the server; the app " +
      "shows the delivery record and return window for each order.",
  ),
  HelpFaq(
    question = "Where do invoices come from?",
    answer = "Open any confirmed or later order and choose Invoice. Totals on the invoice are the " +
      "amounts stored when the order was placed, computed by the server.",
  ),
)

/** One tappable help shortcut: title, one-line detail, chevron, 48dp target. */
@Composable
private fun HelpShortcutRow(
  title: String,
  detail: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    modifier = modifier
      .fillMaxWidth()
      .heightIn(min = MaharaniDimens.touchTarget),
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
        Text(text = title, style = MaterialTheme.typography.titleSmall)
        Text(
          text = detail,
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      ChevronRightGlyph(
        modifier = Modifier.size(18.dp),
        tint = MaterialTheme.colorScheme.primary,
      )
    }
  }
}
