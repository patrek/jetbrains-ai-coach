package com.aicoach.jetbrains.theme

import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter

/**
 * Keeps one open dashboard window's webview in sync with the live IDE theme.
 *
 * On `LafManagerListener.TOPIC` (delivered on the EDT) it re-derives the 23
 * theme variables and sets them on `:root` via `executeJavaScript` — an instant,
 * no-reload recolor of the entire CSS-driven UI. Chart.js captured its colors
 * from `Chart.defaults` at mount and the bundled `Chart` is not reachable from
 * injected JS, so a state-preserving soft reload follows: the reloaded page
 * re-inlines the fresh theme and the persisted `__INITIAL_STATE__`, remounting
 * charts with the new palette without losing page/filter state.
 *
 * The live set-property runs before the reload so the visible UI flips theme
 * immediately while the reload (which re-fetches dashboard data) completes.
 */
class WebviewThemeSync(
    private val browser: JBCefBrowser,
    parent: Disposable,
) : Disposable {

    @Volatile private var loaded = false

    init {
        Disposer.register(parent, this)
        // The first paint already carries the current theme via the scheme
        // handler's inline injection; only act once the page is up.
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (frame.isMain) loaded = true
            }
        }, browser.cefBrowser)
        ApplicationManager.getApplication().messageBus.connect(this)
            .subscribe(LafManagerListener.TOPIC, LafManagerListener { reinject() })
    }

    private fun reinject() {
        if (!loaded) return
        val script = ThemeCssProvider.forCurrentTheme().setPropertyScript()
        runCatching {
            browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
            browser.cefBrowser.reload()
        }.onFailure { log.debug("theme re-injection failed (browser disposed?)", it) }
    }

    override fun dispose() = Unit

    private companion object {
        private val log = logger<WebviewThemeSync>()
    }
}
