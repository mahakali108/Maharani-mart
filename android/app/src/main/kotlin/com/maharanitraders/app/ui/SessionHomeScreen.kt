package com.maharanitraders.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.IsoDateDisplay
import com.maharanitraders.core.designsystem.labels.label
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.RetailerStatus
import com.maharanitraders.core.model.SessionSnapshot
import com.maharanitraders.core.model.Workspace

/** Test tags for the signed-in home surface. */
object HomeTags {
  const val ACCOUNT_CARD = "home_account_card"
  const val ROLE = "home_role"
  const val RETAILER_STATUS = "home_retailer_status"
  const val SIGN_OUT = "home_sign_out"
}

/**
 * The signed-in home screen for Phase B.
 *
 * Everything shown here comes from the server's session payload — name, role,
 * retailer status and the workspaces the account may enter. There is no
 * invented data and no offline "cached identity": this screen is only reachable
 * after the server verified the session.
 */
@Composable
fun SessionHomeScreen(
  snapshot: SessionSnapshot,
  onSignOut: () -> Unit,
) {
  val retailer = snapshot.retailer

  LazyColumn(
    modifier = Modifier
      .fillMaxSize()
      .padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      Card(
        modifier = Modifier
          .fillMaxWidth()
          .testTag(HomeTags.ACCOUNT_CARD),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
      ) {
        Column(modifier = Modifier.padding(16.dp)) {
          Text(
            text = snapshot.user.fullName ?: snapshot.user.email ?: "Your account",
            style = MaterialTheme.typography.titleLarge,
          )
          snapshot.user.email?.let { email ->
            Text(
              text = email,
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          snapshot.user.phone?.let { phone ->
            Text(
              text = phone,
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          Text(
            text = snapshot.role.label(),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
              .padding(top = 8.dp)
              .testTag(HomeTags.ROLE),
          )
        }
      }
    }

    if (retailer != null) {
      item {
        Card(
          modifier = Modifier.fillMaxWidth(),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
          Column(modifier = Modifier.padding(16.dp)) {
            Text(
              text = retailer.shopName ?: "Your shop",
              style = MaterialTheme.typography.titleMedium,
            )
            Row(
              modifier = Modifier.padding(top = 8.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              StatusChip(retailer.status)
            }
          }
        }
      }
    }

    snapshot.access?.let { access ->
      item {
        Card(
          modifier = Modifier.fillMaxWidth(),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
          Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "Access period", style = MaterialTheme.typography.titleMedium)
            Text(
              text = IsoDateDisplay.formatDate(access.expiresAtIso)
                ?.let { "Valid until $it (UTC)" }
                ?: "Expiry date not provided by the server.",
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              modifier = Modifier.padding(top = 4.dp),
            )
          }
        }
      }
    }

    item {
      Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
          containerColor = MaharaniThemeTokens.colors.actionContainer,
          contentColor = MaharaniThemeTokens.colors.onActionContainer,
        ),
      ) {
        Column(modifier = Modifier.padding(16.dp)) {
          Text(text = "Native foundation build", style = MaterialTheme.typography.titleMedium)
          Text(
            text = "This is the Phase B foundation: session restore, role-aware navigation and the " +
              "shared API client. Catalogue, cart, orders, coins and the staff workspaces are " +
              "built in the following phases — none of them are simulated here.",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 4.dp),
          )
        }
      }
    }

    item {
      Text(
        text = "Your workspaces",
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(top = 8.dp),
      )
    }

    items(snapshot.navigation.workspaces) { workspace ->
      WorkspaceRow(workspace)
    }

    item {
      Button(
        onClick = onSignOut,
        modifier = Modifier
          .fillMaxWidth()
          .padding(top = 12.dp)
          .testTag(HomeTags.SIGN_OUT),
        colors = ButtonDefaults.buttonColors(
          containerColor = MaterialTheme.colorScheme.primary,
          contentColor = MaterialTheme.colorScheme.onPrimary,
        ),
      ) {
        Text("Sign out")
      }
    }
  }
}

@Composable
private fun StatusChip(status: RetailerStatus) {
  val colors = MaharaniThemeTokens.colors
  val container = when (status) {
    RetailerStatus.ACTIVE -> colors.inStockSurface
    RetailerStatus.PENDING_APPROVAL -> colors.warningSurface
    RetailerStatus.SUSPENDED, RetailerStatus.UNKNOWN -> colors.outOfStockSurface
  }
  val content = when (status) {
    RetailerStatus.ACTIVE -> colors.inStock
    RetailerStatus.PENDING_APPROVAL -> colors.warning
    RetailerStatus.SUSPENDED, RetailerStatus.UNKNOWN -> colors.outOfStock
  }

  Surface(
    color = container,
    contentColor = content,
    shape = MaterialTheme.shapes.small,
    modifier = Modifier.testTag(HomeTags.RETAILER_STATUS),
  ) {
    Text(
      text = status.label(),
      style = MaterialTheme.typography.labelMedium,
      modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
    )
  }
}

@Composable
private fun WorkspaceRow(workspace: Workspace) {
  Surface(
    color = MaterialTheme.colorScheme.surface,
    shape = MaterialTheme.shapes.small,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Text(
      text = workspace.label(),
      style = MaterialTheme.typography.bodyLarge,
      modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
  }
}
