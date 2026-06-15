package com.aicoach.jetbrains.theme

import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser

/**
 * Keeps one open dashboard window's webview in sync with the live IDE theme.
 *
 * On `LafManagerListener.TOPIC` (delivered on the EDT) it re-derives the 23
 * theme variables and sets them on `:root` via `executeJavaScript` — an instant,
 * no-reload recolor of the entire CSS-driven UI.
 *
 * It deliberately does NOT reload the page. The webview renders only after the
 * sidecar's one-shot `dataReady` push, which is emitted once per sidecar
 * connection; a soft reload restarts the page on the same connection, so
 * `dataReady` is never re-sent and the reloaded page hangs on its loading
 * spinner forever (see buglog bug-030). Chart.js captures its palette from
 * `Chart.defaults` at mount and is not reachable from injected JS, so already
 * mounted charts keep their colors until the tool window is reopened (a fresh
 * connection re-runs the handshake and remounts charts in the new theme).
 */
class WebviewThemeSync(
    private val browser: JBCefBrowser,
    parent: Disposable,
) : Disposable {

    init {
        Disposer.register(parent, this)
        ApplicationManager.getApplication().messageBus.connect(this)
            .subscribe(LafManagerListener.TOPIC, LafManagerListener { reinject() })
    }

    private fun reinject() {
        val script = ThemeCssProvider.forCurrentTheme().setPropertyScript()
        runCatching { browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0) }
            .onFailure { log.debug("theme re-injection failed (browser disposed?)", it) }
    }

    override fun dispose() = Unit

    private companion object {
        private val log = logger<WebviewThemeSync>()
    }
}
