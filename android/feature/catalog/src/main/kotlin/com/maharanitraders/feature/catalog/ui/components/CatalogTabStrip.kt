package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.catalog.CatalogTab
import com.maharanitraders.feature.catalog.ui.CatalogScreenTags

/**
 * The Catalogue's segmented control: Products | Categories | Brands.
 *
 * One pill, three equal segments. The selected segment is filled with the
 * Maharani brand red and its label is white and semibold; the unselected ones
 * sit on the shared neutral track in muted ink. That is three cues at once
 * (fill, weight, contrast) rather than a single colour shift, so "which pane am
 * I on" survives a screenshot, a colour-vision difference and a bright shop
 * window alike.
 *
 * The track is a real surface with a hairline outline instead of a floating
 * pill: the control is a primary navigation element, and on a white header a
 * white-on-white control reads as decoration — the exact "looks unfinished"
 * problem this redesign removes.
 *
 * Accessibility: the row is a [selectableGroup] and each segment is
 * `selectable` with [Role.Tab], so TalkBack announces "tab, 2 of 3, selected"
 * rather than three unlabelled buttons; every segment keeps the 48dp touch
 * target even though the pill is drawn tighter.
 */
@Composable
fun CatalogTabStrip(
  selected: CatalogTab,
  onSelect: (CatalogTab) -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusPill),
    color = MaterialTheme.colorScheme.surfaceContainer,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = modifier
      .fillMaxWidth()
      .testTag(CatalogScreenTags.TAB_ROW),
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(4.dp)
        .selectableGroup(),
      horizontalArrangement = Arrangement.spacedBy(4.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      CatalogTab.entries.forEach { tab ->
        val isSelected = tab == selected
        Box(
          modifier = Modifier
            .weight(1f)
            .heightIn(min = MaharaniDimens.touchTarget)
            .clip(RoundedCornerShape(MaharaniDimens.radiusPill))
            .background(if (isSelected) MaterialTheme.colorScheme.primary else Color.Transparent)
            .selectable(
              selected = isSelected,
              role = Role.Tab,
              onClick = { onSelect(tab) },
            )
            .testTag(tagFor(tab)),
          contentAlignment = Alignment.Center,
        ) {
          Text(
            text = tab.label,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
            color = if (isSelected) {
              MaterialTheme.colorScheme.onPrimary
            } else {
              MaterialTheme.colorScheme.onSurfaceVariant
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
          )
        }
      }
    }
  }
}

/** Test tag per segment, so a UI test can tap a named pane. */
private fun tagFor(tab: CatalogTab): String = when (tab) {
  CatalogTab.PRODUCTS -> CatalogScreenTags.TAB_PRODUCTS
  CatalogTab.CATEGORIES -> CatalogScreenTags.TAB_CATEGORIES
  CatalogTab.BRANDS -> CatalogScreenTags.TAB_BRANDS
}
