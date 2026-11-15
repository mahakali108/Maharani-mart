package com.maharanitraders.app.navigation

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/**
 * The Policies & information routes.
 *
 * These are plain routes rather than drawer destinations because their content is
 * PUBLIC and server-published: the app holds no page list of its own, so the only
 * thing that must be right here is that the route the index navigates to is the
 * route the page screen is registered under, and that the slug cannot escape its
 * own segment.
 */
class LegalRoutesTest {

  @Test
  fun `the page route pattern is the index route plus one segment`() {
    assertThat(MaharaniRoutes.LEGAL).isEqualTo("legal")
    assertThat(MaharaniRoutes.LEGAL_PAGE).isEqualTo("legal/{slug}")
  }

  @Test
  fun `the concrete route fills the slug segment and nothing else`() {
    assertThat(MaharaniRoutes.legalPage("terms")).isEqualTo("legal/terms")
    assertThat(MaharaniRoutes.legalPage("grievance-redressal")).isEqualTo("legal/grievance-redressal")
  }

  @Test
  fun `the concrete route always matches the registered pattern`() {
    val pattern = Regex("^" + MaharaniRoutes.LEGAL_PAGE.replace("{slug}", "[a-z][a-z0-9]*(-[a-z0-9]+)*") + "$")
    listOf("about", "contact", "terms", "privacy", "grievance-redressal", "coins-loyalty").forEach { slug ->
      assertThat(pattern.matches(MaharaniRoutes.legalPage(slug))).isTrue()
    }
    // A slug with a slash would create a second segment and no longer match the
    // registered route, which is exactly why the server's own slug format forbids it.
    assertThat(pattern.matches(MaharaniRoutes.legalPage("a/b"))).isFalse()
  }
}
