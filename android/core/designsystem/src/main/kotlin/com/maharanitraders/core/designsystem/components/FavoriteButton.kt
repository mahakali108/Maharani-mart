package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniDimens

/**
 * The favourite (wishlist) toggle, shared by product cards and product detail.
 *
 * Deliberately a dumb control: it renders the state it is handed and reports a
 * tap. It never decides that a product became a favourite — only the server
 * does, and the caller re-renders once the server has answered. That is why
 * [pending] exists: between the tap and the server's reply the control shows
 * progress and refuses further taps, instead of flipping to a state that the
 * request might not actually produce.
 *
 * Accessibility: the whole control carries one spoken label and one click
 * action, so TalkBack announces "Add to favourites" / "Remove from favourites"
 * rather than reading the decorative glyph underneath. The hit area is always
 * at least [MaharaniDimens.touchTarget] even when the art is drawn smaller.
 */
@Composable
fun FavoriteButton(
  isFavorite: Boolean,
  onToggle: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  pending: Boolean = false,
  onSurface: Boolean = true,
) {
  val label = when {
    pending -> "Updating favourites"
    isFavorite -> "Remove from favourites"
    else -> "Add to favourites"
  }
  val tint = when {
    !enabled -> MaterialTheme.colorScheme.onSurfaceVariant
    isFavorite -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
  }

  Surface(
    onClick = onToggle,
    enabled = enabled && !pending,
    shape = CircleShape,
    color = if (onSurface) {
      MaterialTheme.colorScheme.surface
    } else {
      MaterialTheme.colorScheme.surfaceVariant
    },
    shadowElevation = if (onSurface) MaharaniDimens.cardElevation else 0.dp,
    modifier = modifier
      .size(MaharaniDimens.touchTarget)
      // One node, one label, one action: the glyph below must not be announced
      // separately, and the progress indicator must not steal the action.
      .clearAndSetSemantics {
        contentDescription = label
        onClick(label = label, action = null)
      },
  ) {
    Box(contentAlignment = Alignment.Center) {
      if (pending) {
        CircularProgressIndicator(
          strokeWidth = 2.dp,
          color = MaterialTheme.colorScheme.primary,
          modifier = Modifier.size(18.dp),
        )
      } else {
        HeartGlyph(
          filled = isFavorite,
          tint = tint,
          modifier = Modifier.size(22.dp),
        )
      }
    }
  }
}
