package com.aicoach.jetbrains.theme

import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.ui.JBColor
import com.intellij.util.ui.UIUtil
import java.awt.Color
import javax.swing.UIManager

/**
 * Derives the 23 webview theme variables from the live IDE theme and serializes
 * them for the JCEF dashboard.
 *
 * The webview is upstream VS Code CSS: every color is `var(--vscode-*, fallback)`
 * (styles.css:8-37) and Chart.js reads three more from computed style at mount
 * (shared.ts:106-108). Without host injection every theme renders the dark
 * fallback palette. This maps each variable to a `UIManager` / `JBColor` /
 * `EditorColorsManager` source per the parent plan's table; a color whose source
 * resolves to null is dropped so the CSS fallback applies — graceful degradation
 * for high-contrast and third-party themes, never an unreadable combination.
 *
 * Lookups are injected so the serialization is unit-testable without the IDE
 * platform; [forCurrentTheme] wires the real sources.
 */
class ThemeCssProvider(
    private val uiColor: (String) -> Color?,
    private val editorBackground: () -> Color?,
    private val editorForeground: () -> Color?,
    private val uiFontFamily: () -> String,
    private val lightTheme: () -> Boolean,
) {

    /**
     * The theme variables as CSS-ready values (`#rrggbb` for colors, a family
     * list for the font). Insertion-ordered; variables whose source resolves to
     * null are omitted so the webview's CSS fallback takes over.
     */
    fun variables(): Map<String, String> {
        val palette = if (lightTheme()) LIGHT_CHARTS else DARK_CHARTS
        val vars = LinkedHashMap<String, String>()
        fun put(name: String, color: Color?) { if (color != null) vars[name] = color.toHex() }

        put("--vscode-editor-background", editorBackground())
        put("--vscode-editor-foreground", editorForeground())
        put("--vscode-foreground", uiColor("Label.foreground"))
        put("--vscode-descriptionForeground", uiColor("Label.infoForeground"))
        put("--vscode-sideBar-background", uiColor("Panel.background"))
        put("--vscode-button-background", uiColor("Button.default.startBackground"))
        put("--vscode-button-foreground", uiColor("Button.default.foreground"))
        put("--vscode-badge-background", uiColor("Counter.background"))
        put("--vscode-badge-foreground", uiColor("Counter.foreground"))
        put("--vscode-input-background", uiColor("TextField.background"))
        put("--vscode-input-foreground", uiColor("TextField.foreground"))
        put("--vscode-input-border", uiColor("Component.borderColor"))
        put("--vscode-list-hoverBackground", uiColor("List.hoverBackground"))
        put("--vscode-focusBorder", uiColor("Component.focusedBorderColor"))
        put("--vscode-textLink-foreground", uiColor("Link.activeForeground"))
        put("--vscode-panel-border", uiColor("Component.borderColor"))
        vars["--vscode-charts-red"] = palette.red
        vars["--vscode-charts-green"] = palette.green
        vars["--vscode-charts-blue"] = palette.blue
        vars["--vscode-charts-yellow"] = palette.yellow
        vars["--vscode-charts-orange"] = palette.orange
        vars["--vscode-charts-purple"] = palette.purple
        vars["--vscode-font-family"] = uiFontFamily()
        return vars
    }

    /**
     * A self-invoking script that sets every variable on
     * `document.documentElement` — used both for the first-paint inline injection
     * (prepended to `bootstrap.js`) and for live, no-reload recolor on a theme
     * change. Values are JS-escaped (the font family carries quotes and commas).
     */
    fun setPropertyScript(): String = buildString {
        append("(function(){var s=document.documentElement.style;")
        for ((name, value) in variables()) {
            append("s.setProperty(").append(jsString(name)).append(',').append(jsString(value)).append(");")
        }
        append("})();")
    }

    private class ChartPalette(
        val red: String, val green: String, val blue: String,
        val yellow: String, val orange: String, val purple: String,
    )

    companion object {
        // Fixed chart palettes: UIManager has no chart-color equivalent, so these
        // are host-defined. Two sets tuned for contrast on a dark vs. light
        // canvas; the brightness check picks one. styles.css already ships the
        // dark values as fallbacks, so injecting them keeps charts consistent
        // with the rest of the CSS-driven UI on both themes.
        private val DARK_CHARTS = ChartPalette(
            red = "#f14c4c", green = "#73c991", blue = "#75beff",
            yellow = "#e2c08d", orange = "#d18616", purple = "#b180d7",
        )
        private val LIGHT_CHARTS = ChartPalette(
            red = "#e51400", green = "#388a34", blue = "#1a85ff",
            yellow = "#b58900", orange = "#c4690a", purple = "#652d90",
        )

        /** Wire the real IDE theme sources. Reads are cheap color/font lookups,
         *  consistent with how the scheme handler already samples the theme. */
        fun forCurrentTheme(): ThemeCssProvider = ThemeCssProvider(
            uiColor = { name -> UIManager.getColor(name) },
            editorBackground = { EditorColorsManager.getInstance().globalScheme.defaultBackground },
            editorForeground = { EditorColorsManager.getInstance().globalScheme.defaultForeground },
            uiFontFamily = { UIUtil.getLabelFont().family },
            lightTheme = { JBColor.isBright() },
        )

        private fun Color.toHex(): String = "#%02x%02x%02x".format(red, green, blue)

        private fun jsString(value: String): String =
            "'" + value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"
    }
}
