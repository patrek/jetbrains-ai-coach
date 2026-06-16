package com.aicoach.jetbrains.jcef

import com.aicoach.jetbrains.export.ExportSummaryHandler
import com.aicoach.jetbrains.sidecar.SidecarService
import com.aicoach.jetbrains.sidecar.SidecarSupervisor
import com.aicoach.jetbrains.trust.TrustGateController
import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.ide.BrowserUtil
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.util.concurrency.AppExecutorUtil
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import java.util.ArrayDeque
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The per-window JS<->host relay: one bridge per open dashboard tool window.
 *
 * Webview -> host: `bootstrap.js` posts JSON through `window.__aicoachPost`, a
 * JBCefJSQuery this bridge created **before** the browser loaded (a JCEF
 * platform constraint) and injects on load. The handler runs on a CEF thread, so
 * it never touches Swing. Most methods forward to the shared sidecar; a fixed
 * set are **intercepted** and answered by the host instead (they don't exist in
 * the sidecar by design — ADR 0009).
 *
 * Host -> webview: responses and the sidecar's `progress`/`dataReady` pushes are
 * delivered by dispatching a `MessageEvent`, exactly the shape
 * `shared.ts:initMessageListener` already listens for.
 *
 * Connection: the bridge queues outbound requests until the sidecar handshake
 * (`onConnected`) and fails over to an error state if it doesn't arrive within
 * [CONNECT_TIMEOUT_MS]. Cross-window correlation and the `host-request` trust
 * channel are the shared [SidecarSupervisor]'s job, not this bridge's.
 */
class WebviewBridge(
    private val project: Project,
    private val browser: JBCefBrowser,
    private val service: SidecarService,
) : SidecarSupervisor.Client, Disposable {

    override val clientId: String = "bridge-${SEQ.incrementAndGet()}"

    private val gson = Gson()
    private val query = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase)
    private val projectRoot: String? = project.basePath ?: project.guessProjectDir()?.path
    private val trust = TrustGateController(project, service, projectRoot)
    private val export = ExportSummaryHandler(project, service, projectRoot)

    @Volatile private var connected = false
    @Volatile private var capabilities: JsonObject = JsonObject()

    private data class Pending(val id: String, val method: String, val params: JsonObject?)
    private val outbound = ArrayDeque<Pending>()
    private var connectTimeout: ScheduledFuture<*>? = null

    init {
        query.addHandler { request ->
            handleFromWebview(request)
            null // we reply asynchronously via MessageEvent, not the query callback
        }
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (!frame.isMain) return
                // Wire the webview's postMessage to the native query, then drain
                // anything bootstrap.js buffered before the bridge was ready.
                val js = "window.__aicoachPost = function(m){ ${query.inject("m")} };" +
                    "if (window.__aicoachFlush) window.__aicoachFlush();"
                cefBrowser.executeJavaScript(js, cefBrowser.url, 0)
            }
        }, browser.cefBrowser)

        service.register(this)
        trust.start()
        connectTimeout = AppExecutorUtil.getAppScheduledExecutorService().schedule(
            { if (!connected) onConnectionError("Could not connect to the AI Coach sidecar within ${CONNECT_TIMEOUT_MS / 1000}s.") },
            CONNECT_TIMEOUT_MS,
            TimeUnit.MILLISECONDS,
        )
    }

    // ---- webview -> host -------------------------------------------------

    private fun handleFromWebview(request: String) {
        val message = parse(request) ?: return
        when (message.get("type")?.asStringOrNull()) {
            "persistState" -> persistState(message.get("state"))
            "request" -> handleRequest(message)
            else -> Unit
        }
    }

    private fun handleRequest(message: JsonObject) {
        val id = message.get("id")?.asStringOrNull() ?: return
        val method = message.get("method")?.asStringOrNull() ?: return
        val params = message.get("params")?.takeIf { it.isJsonObject }?.asJsonObject

        when (method) {
            // Host-owned methods — never forwarded; the sidecar returns a typed
            // error / Unknown method for these by design (ADR 0009 Host rows).
            "openExternal" -> {
                params?.get("url")?.asStringOrNull()?.let { BrowserUtil.browse(it) }
                reply(id, ok())
            }
            "saveModelBudgets" -> {
                params?.let { appProperties().setValue(BUDGETS_KEY, it.toString()) }
                reply(id, ok())
            }
            "loadModelBudgets" -> reply(id, parseStored(appProperties().getValue(BUDGETS_KEY)))
            "getCapabilities" -> reply(id, capabilitiesReply())
            // Host-owned trust review: open the IDE dialog, never forward to the
            // sidecar (the bridge intercepts it — ADR 0009 Host row).
            "reviewLocalRules" -> {
                trust.review()
                reply(id, ok())
            }
            // Host-owned export: fetch rendered content from the sidecar, then
            // write via an IntelliJ directory chooser (ADR 0009 Host row).
            "exportSummary" -> export.export(params, trust.safeMode()) { data -> reply(id, data) }
            // Safety net: anything not intercepted above is forwarded. The sidecar
            // answers EVERY forwarded method — a real result, a typed degrade, or a
            // typed `Unknown method` error — so an unmapped method can never hang the
            // webview (whose RPC timeout is 120s). Silence is never an outcome.
            else -> forwardOrQueue(Pending(id, method, params))
        }
    }

    private fun forwardOrQueue(pending: Pending) {
        synchronized(outbound) {
            if (!connected) {
                outbound.add(pending)
                return
            }
        }
        service.forward(this, pending.id, pending.method, pending.params, projectRoot, trust.safeMode())
    }

    private fun persistState(state: JsonElement?) {
        projectProperties().setValue(STATE_KEY, (state ?: JsonObject()).toString())
    }

    // ---- host -> webview (SidecarSupervisor.Client) ---------------------

    override fun onConnected(capabilities: JsonObject) {
        this.capabilities = capabilities
        connected = true
        connectTimeout?.cancel(false)
        val drained = synchronized(outbound) { ArrayDeque(outbound).also { outbound.clear() } }
        for (pending in drained) service.forward(this, pending.id, pending.method, pending.params, projectRoot, trust.safeMode())
        // Surface any already-pending local rules now that the sidecar is up.
        trust.onConnected()
    }

    override fun onConnectionError(message: String) {
        connected = false
        showError(message)
    }

    override fun onResponse(originalId: String, data: JsonElement) {
        deliver(JsonObject().apply {
            addProperty("type", "response")
            addProperty("id", originalId)
            add("data", data)
        })
    }

    override fun onPush(message: JsonObject) {
        deliver(message)
    }

    // ---- helpers ---------------------------------------------------------

    private fun reply(id: String, data: JsonElement) {
        deliver(JsonObject().apply {
            addProperty("type", "response")
            addProperty("id", id)
            add("data", data)
        })
    }

    /** Dispatch a host->webview message as the `MessageEvent` shared.ts expects. */
    private fun deliver(message: JsonObject) {
        val literal = gson.toJson(message.toString()) // safe JS string literal of the JSON
        val js = "window.dispatchEvent(new MessageEvent('message',{data:JSON.parse($literal)}));"
        runCatching { browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0) }
            .onFailure { log.debug("deliver failed (browser disposed?)", it) }
    }

    private fun showError(message: String) {
        val literal = gson.toJson(message)
        val js = """
            (function(){
              var el = document.getElementById('content') || document.body;
              if (el) el.innerHTML = '<div style="padding:24px;color:var(--vscode-errorForeground,#f85149);font-family:sans-serif">' + $literal + '</div>';
            })();
        """.trimIndent()
        runCatching { browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0) }
    }

    private fun capabilitiesReply(): JsonObject = JsonObject().apply {
        addProperty("llm", false)
        addProperty("github", capabilities.get("github")?.let { it.isJsonPrimitive && it.asBoolean } ?: false)
        addProperty("host", "jetbrains")
    }

    private fun ok(): JsonObject = JsonObject().apply { addProperty("ok", true) }

    private fun parseStored(json: String?): JsonElement =
        runCatching { JsonParser.parseString(json ?: "{}") }.getOrDefault(JsonObject())

    private fun parse(line: String): JsonObject? =
        runCatching { JsonParser.parseString(line).takeIf { it.isJsonObject }?.asJsonObject }.getOrNull()

    private fun JsonElement.asStringOrNull(): String? =
        if (isJsonPrimitive && asJsonPrimitive.isString) asString else null

    private fun appProperties() = PropertiesComponent.getInstance()
    private fun projectProperties() = PropertiesComponent.getInstance(project)

    override fun dispose() {
        connectTimeout?.cancel(false)
        trust.dispose()
        service.unregister(this)
        com.intellij.openapi.util.Disposer.dispose(query)
    }

    companion object {
        const val STATE_KEY = "aicoach.webviewState"
        const val BUDGETS_KEY = "aicoach.modelBudgets"
        private const val CONNECT_TIMEOUT_MS = 10_000L
        private val SEQ = AtomicInteger(0)
        private val log = logger<WebviewBridge>()

        /** The persisted UI state for [project], inlined at serve time by the
         *  scheme handler so `getState()` is synchronous. */
        fun currentState(project: Project): String =
            PropertiesComponent.getInstance(project).getValue(STATE_KEY, "{}")
    }
}
