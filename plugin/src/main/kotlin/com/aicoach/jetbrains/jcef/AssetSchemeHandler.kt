package com.aicoach.jetbrains.jcef

import com.intellij.openapi.diagnostic.logger
import com.intellij.ui.jcef.JBCefApp
import org.cef.CefApp
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefCallback
import org.cef.callback.CefSchemeHandlerFactory
import org.cef.handler.CefResourceHandler
import org.cef.handler.CefResourceHandlerAdapter
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import java.net.URI
import java.nio.charset.StandardCharsets

/**
 * Serves the webview bundle to JCEF from the plugin JAR under a real origin.
 *
 * Decision D7: `loadHTML` proxies through `file://` and breaks relative
 * `<script src>` resolution and Trusted Types; a custom scheme handler serves
 * bundled resources and gives a real secure origin. We use the standard `https`
 * scheme with a per-window domain (`aicoach-<n>`), so:
 *   - no custom-scheme registration timing dance (https is already standard);
 *   - each window gets an isolated origin, so the request-time inlined
 *     `__INITIAL_STATE__` is that window's state, not a shared one.
 *
 * `index.html` carries the CSP; `bootstrap.js` is rewritten per request to
 * inline the persisted UI state and the theme-injection script (the 23-variable
 * mapping painted before first frame).
 */
object AssetSchemeHandler {

    const val SCHEME = "https"
    private val log = logger<AssetSchemeHandler>()

    /**
     * Register a per-window asset factory and return the URL to load. The
     * [stateJsonProvider] is read synchronously on each `bootstrap.js` request
     * (JCEF has no synchronous JS->host call, so state must be inlined at serve
     * time); [themeScriptProvider] supplies the theme-injection script that
     * paints the first frame in the IDE theme (the 23-variable mapping).
     */
    fun register(domain: String, stateJsonProvider: () -> String, themeScriptProvider: () -> String): String {
        JBCefApp.getInstance() // ensure CEF is initialized before registering
        val registered = CefApp.getInstance()
            .registerSchemeHandlerFactory(SCHEME, domain, Factory(stateJsonProvider, themeScriptProvider))
        if (!registered) log.warn("Failed to register asset scheme handler for $SCHEME://$domain")
        return "$SCHEME://$domain/index.html"
    }

    private class Factory(
        private val stateJsonProvider: () -> String,
        private val themeScriptProvider: () -> String,
    ) : CefSchemeHandlerFactory {
        override fun create(
            browser: CefBrowser?,
            frame: CefFrame?,
            schemeName: String?,
            request: CefRequest,
        ): CefResourceHandler {
            return when (val path = pathOf(request.url)) {
                "", "/", "/index.html" -> resource("index.html", MIME_HTML)
                "/app.js" -> resource("app.js", MIME_JS)
                "/styles.css" -> resource("styles.css", MIME_CSS)
                "/test-harness.html" -> resource("test-harness.html", MIME_HTML)
                "/bootstrap.js" -> bootstrap()
                else -> {
                    log.debug("Asset 404: $path")
                    NotFoundHandler
                }
            }
        }

        private fun bootstrap(): CefResourceHandler {
            val prefix = buildPrefix(stateJsonProvider(), themeScriptProvider())
            val core = readResource("bootstrap.js") ?: return NotFoundHandler
            val bytes = (prefix.toByteArray(StandardCharsets.UTF_8) + core)
            return ByteArrayResourceHandler(bytes, MIME_JS)
        }

        private fun resource(name: String, mime: String): CefResourceHandler {
            val bytes = readResource(name) ?: return NotFoundHandler
            return ByteArrayResourceHandler(bytes, mime)
        }
    }

    /** The inlined preamble prepended to `bootstrap.js` at serve time: the
     *  persisted UI state, then the theme-injection script. bootstrap.js loads in
     *  `<head>` before app.js, so the `:root` variables are set before first
     *  paint — no white flash. */
    internal fun buildPrefix(stateJson: String, themeScript: String): String {
        val state = stateJson.ifBlank { "{}" }
        return buildString {
            append("window.__INITIAL_STATE__ = ").append(state).append(";\n")
            append(themeScript).append("\n")
        }
    }

    private fun pathOf(url: String): String = runCatching { URI(url).path ?: "" }.getOrDefault("")

    private fun readResource(name: String): ByteArray? =
        AssetSchemeHandler::class.java.getResourceAsStream("/webview/$name")?.use { it.readBytes() }

    private const val MIME_HTML = "text/html"
    private const val MIME_JS = "text/javascript"
    private const val MIME_CSS = "text/css"

    /** Streams a fixed byte array as a 200 response, chunked into JCEF's buffer. */
    private class ByteArrayResourceHandler(
        private val data: ByteArray,
        private val mimeType: String,
    ) : CefResourceHandlerAdapter() {
        private var offset = 0

        override fun processRequest(request: CefRequest, callback: CefCallback): Boolean {
            callback.Continue()
            return true
        }

        override fun getResponseHeaders(response: CefResponse, responseLength: IntRef, redirectUrl: StringRef) {
            response.mimeType = mimeType
            response.status = 200
            responseLength.set(data.size)
        }

        override fun readResponse(
            dataOut: ByteArray,
            bytesToRead: Int,
            bytesRead: IntRef,
            callback: CefCallback,
        ): Boolean {
            if (offset >= data.size) {
                bytesRead.set(0)
                return false
            }
            val count = minOf(bytesToRead, data.size - offset)
            System.arraycopy(data, offset, dataOut, 0, count)
            offset += count
            bytesRead.set(count)
            return true
        }
    }

    private object NotFoundHandler : CefResourceHandlerAdapter() {
        override fun processRequest(request: CefRequest, callback: CefCallback): Boolean {
            callback.Continue()
            return true
        }

        override fun getResponseHeaders(response: CefResponse, responseLength: IntRef, redirectUrl: StringRef) {
            response.status = 404
            responseLength.set(0)
        }
    }
}
