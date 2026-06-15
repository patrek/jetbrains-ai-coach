package com.aicoach.jetbrains.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.awt.Color

/**
 * Serialization and mapping logic for [ThemeCssProvider] with the IDE theme
 * sources faked — no platform, no real LaF. Verifies the full 23-variable set,
 * hex serialization, graceful omission of unmapped colors, the light/dark chart
 * palette switch, and JS-escaping of the injection script.
 */
class ThemeCssProviderTest {

    // Every UIManager key the provider reads, so the "all resolve" cases produce
    // the complete set. Distinct keys: Component.borderColor feeds two variables.
    private val allUiColors: Map<String, Color> = mapOf(
        "Label.foreground" to Color(0x10, 0x11, 0x12),
        "Label.infoForeground" to Color(0x20, 0x21, 0x22),
        "Panel.background" to Color(0x30, 0x31, 0x32),
        "Button.default.startBackground" to Color(0x40, 0x41, 0x42),
        "Button.default.foreground" to Color(0x50, 0x51, 0x52),
        "Counter.background" to Color(0x60, 0x61, 0x62),
        "Counter.foreground" to Color(0x70, 0x71, 0x72),
        "TextField.background" to Color(0x80, 0x81, 0x82),
        "TextField.foreground" to Color(0x90, 0x91, 0x92),
        "Component.borderColor" to Color(0xa0, 0xa1, 0xa2),
        "List.hoverBackground" to Color(0xb0, 0xb1, 0xb2),
        "Component.focusedBorderColor" to Color(0xc0, 0xc1, 0xc2),
        "Link.activeForeground" to Color(0xd0, 0xd1, 0xd2),
    )

    private fun provider(
        colors: Map<String, Color> = allUiColors,
        editorBg: Color? = Color(0x1e, 0x1e, 0x1e),
        editorFg: Color? = Color(0xd4, 0xd4, 0xd4),
        font: String = "Inter",
        light: Boolean = false,
    ) = ThemeCssProvider(
        uiColor = { colors[it] },
        editorBackground = { editorBg },
        editorForeground = { editorFg },
        uiFontFamily = { font },
        lightTheme = { light },
    )

    @Test
    fun `maps all 23 variables when every source resolves`() {
        val vars = provider().variables()
        assertEquals(23, vars.size)
        // The two read at Chart.js mount must be present (acceptance criterion).
        assertTrue(vars.containsKey("--vscode-panel-border"))
        assertTrue(vars.containsKey("--vscode-font-family"))
    }

    @Test
    fun `serializes colors as lowercase six-digit hex`() {
        val vars = provider().variables()
        assertEquals("#1e1e1e", vars["--vscode-editor-background"])
        assertEquals("#d4d4d4", vars["--vscode-editor-foreground"])
        assertEquals("#101112", vars["--vscode-foreground"])
        assertEquals("#a0a1a2", vars["--vscode-input-border"])
        // Component.borderColor feeds both input-border and panel-border.
        assertEquals(vars["--vscode-input-border"], vars["--vscode-panel-border"])
    }

    @Test
    fun `drops unmapped ui colors so the css fallback applies`() {
        val sparse = allUiColors - "Link.activeForeground" - "List.hoverBackground"
        val vars = provider(colors = sparse).variables()
        assertFalse(vars.containsKey("--vscode-textLink-foreground"))
        assertFalse(vars.containsKey("--vscode-list-hoverBackground"))
        // Editor, chart, and font variables are never dropped.
        assertTrue(vars.containsKey("--vscode-editor-background"))
        assertEquals(7, vars.keys.count { it.startsWith("--vscode-charts-") || it == "--vscode-font-family" })
    }

    @Test
    fun `drops editor colors when the scheme has none`() {
        val vars = provider(editorBg = null, editorFg = null).variables()
        assertFalse(vars.containsKey("--vscode-editor-background"))
        assertFalse(vars.containsKey("--vscode-editor-foreground"))
    }

    @Test
    fun `chart palette switches with theme brightness`() {
        val dark = provider(light = false).variables()["--vscode-charts-red"]
        val light = provider(light = true).variables()["--vscode-charts-red"]
        assertEquals("#f14c4c", dark)
        assertEquals("#e51400", light)
    }

    @Test
    fun `set-property script sets one property per variable`() {
        val provider = provider()
        val script = provider.setPropertyScript()
        val count = Regex("setProperty\\(").findAll(script).count()
        assertEquals(provider.variables().size, count)
        assertTrue(script.startsWith("(function(){"))
        assertTrue(script.contains("document.documentElement.style"))
    }

    @Test
    fun `js-escapes font families with quotes and apostrophes`() {
        val script = provider(font = """It's "Segoe UI", sans-serif""").setPropertyScript()
        // The single quote must be backslash-escaped; the script must stay a
        // valid single-quoted JS string literal.
        assertTrue(script.contains("""It\'s "Segoe UI", sans-serif"""))
    }

    @Test
    fun `js-escapes backslashes in font families`() {
        val script = provider(font = """C:\Windows\Fonts""").setPropertyScript()
        // Each backslash must be doubled so the JS literal is well-formed.
        assertTrue(script.contains("""C:\\Windows\\Fonts"""))
    }
}
