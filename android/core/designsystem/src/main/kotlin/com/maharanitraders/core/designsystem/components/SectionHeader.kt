package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens

/**
 * The heading every shopping section opens with: a warm-gold accent bar, the
 * title, an optional context line and an optional trailing action ("View all").
 *
 * The accent bar is the one piece of colour that separates one section from the
 * next on a white page, so long vertical screens read as a rhythm of sections
 * rather than as an undifferentiated list of cards.
 *
 * The action is a [TextButton] on purpose — it already carries the button role
 * for TalkBack and a padded touch target — with a chevron so "View all" reads
 * as navigation rather than as a filter.
 */
@Composable
fun SectionHeader(
  title: String,
  modifier: Modifier = Modifier,
  subtitle: String? = null,
  actionLabel: String? = null,
  onAction: (() -> Unit)? = null,
) {
  Row(
    modifier = modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Column(
      modifier = Modifier.weight(1f),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
    ) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        Box(
          modifier = Modifier
            .width(4.dp)
            .height(18.dp)
            .clip(RoundedCornerShape(MaharaniDimens.radiusPill))
            .background(MaharaniThemeTokens.colors.saffron),
        )
        Text(
          text = title,
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          color = MaterialTheme.colorScheme.onBackground,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
      if (subtitle != null) {
        Text(
          text = subtitle,
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }

    if (actionLabel != null && onAction != null) {
      TextButton(
        onClick = onAction,
        modifier = Modifier.heightIn(min = 44.dp),
      ) {
        Text(
          text = actionLabel,
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.primary,
          maxLines = 1,
        )
        Spacer(modifier = Modifier.width(MaharaniDimens.spaceXxs))
        ChevronRightGlyph(
          modifier = Modifier.size(16.dp),
          tint = MaterialTheme.colorScheme.primary,
        )
      }
    }
  }
}
