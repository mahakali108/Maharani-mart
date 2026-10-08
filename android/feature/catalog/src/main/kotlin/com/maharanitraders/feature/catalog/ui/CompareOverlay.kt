package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.feature.catalog.ProductCompare
import com.maharanitraders.feature.catalog.ui.components.ProductImage

/** Test tags for the comparison surface. */
object CompareTags {
  const val SCREEN = "compare_screen"
  const val TABLE = "compare_table"
  const val CLOSE = "compare_close"
  const val REMOVE = "compare_remove"
  const val EMPTY = "compare_empty"
}

private object CompareColumns {
  /** Width of the label rail; the rest is split between up to four products. */
  val LABEL = 104.dp
  val ARTWORK_HEADER = 148.dp
}

/**
 * Side-by-side comparison of up to four products, drawn over the catalogue.
 *
 * Every cell is a value the server published for the signed-in retailer
 * (see [ProductCompare.rows]): the overlay holds no product of its own, and a
 * figure the server did not send reads "Not published" rather than being filled
 * in from another row. Details are fetched fresh when the overlay opens, so a
 * comparison can never quote yesterday's rate.
 *
 * The table scrolls horizontally rather than shrinking type: four columns plus
 * the label rail do not fit 360dp at a readable size, and squeezing them until
 * they do is how a comparison becomes unreadable.
 */
@Composable
fun CompareOverlay(
  details: List<ProductDetail>,
  loading: Boolean,
  error: String?,
  onClose: () -> Unit,
  onRemove: (String) -> Unit,
  onOpenProduct: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    modifier = modifier
      .fillMaxSize()
      .testTag(CompareTags.SCREEN),
    color = MaterialTheme.colorScheme.surface,
  ) {
    Column(
      modifier = Modifier
        .fillMaxSize()
        .padding(MaharaniDimens.pageGutter),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      SectionHeader(
        title = "Compare products",
        subtitle = if (details.isEmpty()) {
          "Pick up to ${ProductCompare.MAX_PRODUCTS} products"
        } else {
          "Today's rates for your shop · GST included"
        },
      )

      when {
        loading && details.isEmpty() -> Box(
          modifier = Modifier
            .fillMaxWidth()
            .weight(1f),
          contentAlignment = Alignment.Center,
        ) { CircularProgressIndicator() }

        error != null && details.isEmpty() -> ErrorState(
          message = error,
          modifier = Modifier.weight(1f),
          retryable = false,
          onRetry = null,
        )

        details.isEmpty() -> Box(
          modifier = Modifier
            .fillMaxWidth()
            .weight(1f)
            .testTag(CompareTags.EMPTY),
          contentAlignment = Alignment.Center,
        ) {
          Text(
            text = "Select two or four products to see them side by side.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
          )
        }

        else -> {
          val rows = ProductCompare.rows(details)
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .weight(1f)
              .horizontalScroll(rememberScrollState())
              .testTag(CompareTags.TABLE),
            horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
          ) {
            Column(modifier = Modifier.width(CompareColumns.LABEL)) {
              Box(modifier = Modifier.heightIn(min = CompareColumns.ARTWORK_HEADER))
              rows.forEach { row -> CompareLabelCell(row.label) }
            }
            details.forEachIndexed { productIndex, detail ->
              Column(
                modifier = Modifier.width(132.dp),
                verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
              ) {
                CompareProductHeader(
                  detail = detail,
                  onOpen = { onOpenProduct(detail.id) },
                  onRemove = { onRemove(detail.id) },
                )
                rows.forEach { row ->
                  CompareValueCell(row.values.getOrNull(productIndex).orEmpty())
                }
              }
            }
          }

          if (error != null) {
            Text(
              text = error,
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.error,
            )
          }
        }
      }

      OutlinedButton(
        onClick = onClose,
        modifier = Modifier
          .fillMaxWidth()
          .heightIn(min = MaharaniDimens.touchTarget)
          .testTag(CompareTags.CLOSE),
        shape = RoundedCornerShape(MaharaniDimens.radiusTile),
      ) { Text("Back to the catalogue") }
    }
  }
}

@Composable
private fun CompareLabelCell(label: String) {
  Text(
    text = label,
    style = MaterialTheme.typography.labelSmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    maxLines = 2,
    overflow = TextOverflow.Ellipsis,
    modifier = Modifier
      .padding(vertical = MaharaniDimens.spaceXs)
      .heightIn(min = 40.dp),
  )
}

@Composable
private fun CompareValueCell(value: String) {
  Text(
    text = value,
    style = MaterialTheme.typography.bodySmall,
    fontWeight = FontWeight.Medium,
    color = MaterialTheme.colorScheme.onSurface,
    maxLines = 2,
    overflow = TextOverflow.Ellipsis,
    modifier = Modifier
      .padding(vertical = MaharaniDimens.spaceXs)
      .heightIn(min = 40.dp),
  )
}

@Composable
private fun CompareProductHeader(
  detail: ProductDetail,
  onOpen: () -> Unit,
  onRemove: () -> Unit,
) {
  Column(
    modifier = Modifier.fillMaxWidth(),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
  ) {
    ProductImage(
      url = detail.heroImages.firstOrNull(),
      fallbackLabel = detail.name,
      modifier = Modifier
        .fillMaxWidth()
        .aspectRatio(1f)
        .clip(RoundedCornerShape(MaharaniDimens.radiusChip)),
    )
    Text(
      text = detail.name,
      style = MaterialTheme.typography.labelMedium,
      fontWeight = FontWeight.SemiBold,
      maxLines = 2,
      overflow = TextOverflow.Ellipsis,
      minLines = 2,
    )
    Row(modifier = Modifier.fillMaxWidth()) {
      TextButton(
        onClick = onOpen,
        modifier = Modifier
          .weight(1f)
          .heightIn(min = MaharaniDimens.touchTarget),
        contentPadding = PaddingValues(horizontal = 4.dp),
      ) { Text("View", style = MaterialTheme.typography.labelSmall) }
      TextButton(
        onClick = onRemove,
        modifier = Modifier
          .weight(1f)
          .heightIn(min = MaharaniDimens.touchTarget)
          .testTag("${CompareTags.REMOVE}_${detail.id}"),
        contentPadding = PaddingValues(horizontal = 4.dp),
      ) {
        Text(
          "Remove",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.error,
        )
      }
    }
  }
}
