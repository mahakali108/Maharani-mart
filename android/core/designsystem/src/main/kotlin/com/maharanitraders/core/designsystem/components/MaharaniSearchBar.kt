package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens

/**
 * The app's single search affordance.
 *
 * One rounded field for the home app bar and the catalogue header, so search
 * looks and behaves identically everywhere: leading magnifier, clear action,
 * an in-field progress ring while a query is in flight, and the IME search
 * action submitting the term. The field itself owns no query and no results —
 * the caller's ViewModel does — so it can never show suggestions the server
 * did not return.
 *
 * `onBar` switches the field to the variant that sits on the coloured shopping
 * app bar (white surface, ink text); the default variant sits on a white page.
 */
@Composable
fun MaharaniSearchBar(
  value: String,
  onValueChange: (String) -> Unit,
  onSubmit: () -> Unit,
  modifier: Modifier = Modifier,
  placeholder: String = "Search products, brands and pack sizes",
  loading: Boolean = false,
  enabled: Boolean = true,
  onBar: Boolean = false,
  testTag: String? = null,
) {
  val tokens = MaharaniThemeTokens.colors

  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(MaharaniDimens.radiusField),
    // On a page the field is a soft neutral well with a hairline edge, not a
    // white pill on a white header: a shadow alone made it read as a blank strip
    // in the middle of the catalogue.
    color = if (onBar) tokens.appBarField else MaterialTheme.colorScheme.surfaceContainerLow,
    contentColor = if (onBar) tokens.onAppBarField else MaterialTheme.colorScheme.onSurface,
    border = if (onBar) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    // No shadow on either variant: depth on a page comes from the field's own
    // tone and hairline edge, and on the app bar there is nothing to cast onto.
    shadowElevation = 0.dp,
  ) {
    Row(
      modifier = Modifier
        .heightIn(min = MaharaniDimens.searchFieldHeight)
        .then(if (testTag != null) Modifier.testTag(testTag) else Modifier)
        .padding(start = 14.dp, end = 4.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      SearchGlyph(
        modifier = Modifier.size(20.dp),
        tint = if (onBar) tokens.appBarFieldHint else MaterialTheme.colorScheme.onSurfaceVariant,
      )

      Box(
        modifier = Modifier
          .weight(1f)
          .padding(start = 10.dp, end = 6.dp),
      ) {
        if (value.isEmpty()) {
          Text(
            text = placeholder,
            style = MaterialTheme.typography.bodyMedium,
            color = if (onBar) tokens.appBarFieldHint else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
        BasicTextField(
          value = value,
          onValueChange = onValueChange,
          enabled = enabled,
          singleLine = true,
          textStyle = MaterialTheme.typography.bodyMedium.copy(color = LocalContentColor.current),
          cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
          keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
          modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = "Search the catalogue" },
        )
      }

      when {
        loading -> CircularProgressIndicator(
          modifier = Modifier
            .padding(end = 12.dp)
            .size(18.dp),
          strokeWidth = 2.dp,
          color = if (onBar) tokens.appBarFieldHint else MaterialTheme.colorScheme.primary,
        )

        value.isNotEmpty() -> IconButton(
          onClick = { onValueChange("") },
          modifier = Modifier.size(40.dp),
        ) {
          CloseGlyph(
            modifier = Modifier.size(18.dp),
            tint = if (onBar) tokens.appBarFieldHint else MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
    }
  }
}
