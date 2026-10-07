package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.IsoDateDisplay
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.feature.orders.OrderStatusEntry

/** Test tag of the order status timeline. */
const val ORDER_TIMELINE_TAG = "order_timeline"

/** Where one step of the timeline stands. */
enum class OrderTimelineState {
  /** Already recorded for this order. */
  DONE,

  /** The order's current status. */
  CURRENT,

  /** Recorded later than the current status (a status written out of order). */
  LATER,
}

/** One row of the order timeline. */
data class OrderTimelineStep(
  val status: String,
  val heading: String,
  val note: String?,
  /** ISO timestamp the server recorded, shown as-is when it cannot be parsed. */
  val at: String?,
  val state: OrderTimelineState,
)

/**
 * The order's status history as a timeline — ONLY the rows the server has.
 *
 * WHAT THIS NEVER DOES
 * It does not invent stages. There is no fixed six-step ladder drawn with greyed
 * placeholders for stages the backend does not record, and no courier GPS: the
 * steps are the `order_status_history` rows of THIS order, in the order the
 * server recorded them, plus the order's own current status when the history
 * does not already contain it. An order with two recorded rows shows two rows.
 *
 * The CURRENT step is the last history row matching the order's status (or the
 * last row at all when the server has moved on without writing a row), so the
 * shopkeeper can see how far the order actually got rather than how far a
 * diagram says it should be.
 */
fun orderTimeline(history: List<OrderStatusEntry>, currentStatus: String): List<OrderTimelineStep> {
  if (history.isEmpty()) {
    return listOf(
      OrderTimelineStep(
        status = currentStatus,
        heading = orderStatusHeading(currentStatus),
        note = null,
        at = null,
        state = OrderTimelineState.CURRENT,
      ),
    )
  }

  val normalized = currentStatus.trim().lowercase()
  // The LAST recorded row that matches the order's status: a status written
  // twice (returned, then re-delivered) must not highlight the first one.
  val currentIndex = history.indexOfLast { it.status.trim().lowercase() == normalized }
    .takeIf { it >= 0 }
    ?: history.lastIndex

  return history.mapIndexed { index, entry ->
    OrderTimelineStep(
      status = entry.status,
      heading = orderStatusHeading(entry.status),
      note = entry.note?.takeIf { it.isNotBlank() },
      at = entry.createdAt,
      state = when {
        index < currentIndex -> OrderTimelineState.DONE
        index == currentIndex -> OrderTimelineState.CURRENT
        else -> OrderTimelineState.LATER
      },
    )
  }
}

/**
 * The visual timeline.
 *
 * Colour is not the only signal: every step carries its own words ("Order
 * placed", "Delivered"), the current step is marked with a filled ring and a
 * "Now" label, and completed steps carry a filled dot — so the state survives
 * being read without colour perception.
 */
@Composable
fun OrderTimeline(
  steps: List<OrderTimelineStep>,
  modifier: Modifier = Modifier,
) {
  val tokens = MaharaniThemeTokens.colors
  Column(
    modifier = modifier
      .fillMaxWidth()
      .testTag(ORDER_TIMELINE_TAG),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
  ) {
    steps.forEachIndexed { index, step ->
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
      ) {
        // The rail: a marker, and a connector down to the next step.
        Column(
          modifier = Modifier.width(20.dp),
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          Box(
            modifier = Modifier
              .size(if (step.state == OrderTimelineState.CURRENT) 16.dp else 12.dp)
              .background(
                color = when (step.state) {
                  OrderTimelineState.DONE -> tokens.inStock
                  OrderTimelineState.CURRENT -> MaterialTheme.colorScheme.primary
                  OrderTimelineState.LATER -> MaterialTheme.colorScheme.outlineVariant
                },
                shape = CircleShape,
              ),
          )
          if (index != steps.lastIndex) {
            Box(
              modifier = Modifier
                .width(2.dp)
                .height(24.dp)
                .padding(vertical = MaharaniDimens.spaceXxs)
                .background(
                  color = if (step.state == OrderTimelineState.DONE) {
                    tokens.inStock
                  } else {
                    MaterialTheme.colorScheme.outlineVariant
                  },
                ),
            )
          }
        }

        Column(
          modifier = Modifier
            .weight(1f)
            .padding(bottom = MaharaniDimens.spaceSm),
          verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
        ) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(
              text = step.heading,
              style = MaterialTheme.typography.titleSmall,
              fontWeight = if (step.state == OrderTimelineState.CURRENT) FontWeight.SemiBold else FontWeight.Normal,
              color = if (step.state == OrderTimelineState.LATER) {
                MaterialTheme.colorScheme.onSurfaceVariant
              } else {
                MaterialTheme.colorScheme.onSurface
              },
              modifier = Modifier.weight(1f),
            )
            if (step.state == OrderTimelineState.CURRENT) {
              Text(
                text = "Now",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
              )
            }
          }
          step.note?.let { note ->
            Text(
              text = note,
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          step.at?.let { at ->
            Text(
              text = IsoDateDisplay.formatDate(at) ?: at,
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }
      if (index != steps.lastIndex) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
      }
    }
  }
}
