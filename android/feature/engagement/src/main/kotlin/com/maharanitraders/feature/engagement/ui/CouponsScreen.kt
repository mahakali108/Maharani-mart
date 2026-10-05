package com.maharanitraders.feature.engagement.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.IsoDateDisplay
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.engagement.CouponItem
import com.maharanitraders.feature.engagement.CouponsViewModel

object CouponsTags {
  const val SCREEN = "coupons_screen"
  const val ITEM = "coupon_item"
}

@Composable
fun CouponsScreen(
  modifier: Modifier = Modifier,
  viewModel: CouponsViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  CouponsContent(
    state = state,
    onRefresh = viewModel::load,
    modifier = modifier,
  )
}

@Composable
fun CouponsContent(
  state: com.maharanitraders.feature.engagement.CouponsUiState,
  onRefresh: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (state.loading && state.coupons.isEmpty()) {
    LoadingState("Loading coupons…", modifier)
    return
  }
  if (state.coupons.isEmpty() && state.errorMessage != null) {
    if (state.offline) OfflineState(modifier, onRetry = onRefresh)
    else ErrorState(state.errorMessage.orEmpty(), modifier, retryable = true, onRetry = onRefresh)
    return
  }

  val available = state.coupons.filter { it.section == "available" }
  val startingSoon = state.coupons.filter { it.section == "starting_soon" }
  val recentlyExpired = state.coupons.filter { it.section == "recently_expired" }
  val used = state.coupons.filter { it.section in listOf("used", "exhausted") }

  if (state.coupons.isEmpty()) {
    EmptyState(
      title = "No coupons right now",
      message = "When Maharani Traders launches an offer for your shop, the code will appear here.",
      actionLabel = "Refresh",
      onAction = onRefresh,
      modifier = modifier.fillMaxSize().testTag(CouponsTags.SCREEN),
    )
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(CouponsTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column {
        Text("Coupons & offers", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(
          "Codes you can use on your next order. Every code is checked on our servers before it is applied.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }

    if (available.isNotEmpty()) {
      item {
        Text(
          "Available now",
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          color = MaterialTheme.colorScheme.primary,
        )
      }
      items(available, key = { it.id }) { coupon ->
        CouponCard(coupon = coupon)
      }
    }

    if (startingSoon.isNotEmpty()) {
      item {
        Text(
          "Starting soon",
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
        )
      }
      items(startingSoon, key = { it.id }) { coupon ->
        CouponCard(coupon = coupon, scheduled = true)
      }
    }

    if (recentlyExpired.isNotEmpty()) {
      item {
        Text(
          "Recently expired",
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      items(recentlyExpired, key = { it.id }) { coupon ->
        CouponCard(coupon = coupon, expired = true)
      }
    }

    if (used.isNotEmpty()) {
      item {
        Text(
          "Already used",
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      items(used, key = { it.id }) { coupon ->
        CouponCard(coupon = coupon, used = true)
      }
    }

    if (state.errorMessage != null) {
      item {
        Button(onClick = onRefresh, modifier = Modifier.fillMaxWidth()) { Text("Refresh") }
      }
    }
  }
}

@Composable
private fun CouponCard(
  coupon: CouponItem,
  modifier: Modifier = Modifier,
  scheduled: Boolean = false,
  expired: Boolean = false,
  used: Boolean = false,
) {
  val borderColor = when {
    expired || used -> MaterialTheme.colorScheme.outlineVariant
    scheduled -> MaterialTheme.colorScheme.tertiary.copy(alpha = 0.3f)
    else -> MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
  }

  Surface(
    modifier = modifier.fillMaxWidth().testTag("${CouponsTags.ITEM}_${coupon.id}"),
    shape = RoundedCornerShape(16.dp),
    color = MaterialTheme.colorScheme.surface,
    border = androidx.compose.foundation.BorderStroke(1.dp, borderColor),
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Surface(
          color = when {
            expired || used -> MaterialTheme.colorScheme.surfaceVariant
            scheduled -> MaterialTheme.colorScheme.tertiaryContainer
            else -> MaterialTheme.colorScheme.primaryContainer
          },
          shape = RoundedCornerShape(8.dp),
        ) {
          Text(
            coupon.code,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
          )
        }
        if (scheduled) {
          Text("Starting soon", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.tertiary)
        }
        if (expired) {
          Text("Expired", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
        }
        if (used) {
          Text("Used", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      Text(coupon.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      coupon.description?.takeIf { it.isNotBlank() }?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      discountLabel(coupon)?.let { label ->
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
      }
      coupon.expiresAt?.let { expires ->
        val formatted = IsoDateDisplay.formatDate(expires)
        Text(
          "Valid till ${formatted ?: expires}",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}

private fun discountLabel(coupon: CouponItem): String? = when (coupon.discountType) {
  "percentage" -> {
    val base = "${coupon.discountValue.toInt()}% off"
    if (coupon.maximumDiscount != null) "$base (up to ₹${coupon.maximumDiscount.toInt()})" else base
  }
  "flat" -> "₹${coupon.discountValue.toInt()} off"
  else -> null
}