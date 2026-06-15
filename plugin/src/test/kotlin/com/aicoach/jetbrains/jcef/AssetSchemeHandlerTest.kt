package com.aicoach.jetbrains.jcef

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure, platform-free part of the scheme handler: the preamble prepended to
 * `bootstrap.js`. Order is the "no white flash" acceptance criterion — the
 * persisted state must be defined before the theme script runs, both before
 * app.js parses.
 */
class AssetSchemeHandlerTest {

    @Test
    fun `inlines state then theme script in order`() {
        val prefix = AssetSchemeHandler.buildPrefix("""{"page":"dashboard"}""", "THEME();")
        assertEquals(
            "window.__INITIAL_STATE__ = {\"page\":\"dashboard\"};\nTHEME();\n",
            prefix,
        )
        assertTrue(prefix.indexOf("__INITIAL_STATE__") < prefix.indexOf("THEME();"))
    }

    @Test
    fun `defaults blank state to an empty object`() {
        val prefix = AssetSchemeHandler.buildPrefix("", "THEME();")
        assertTrue(prefix.startsWith("window.__INITIAL_STATE__ = {};"))
    }
}
