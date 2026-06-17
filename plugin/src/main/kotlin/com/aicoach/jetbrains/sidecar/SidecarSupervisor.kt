package com.aicoach.jetbrains.sidecar

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser

/**
 * The app-level sidecar's protocol policy, free of any IntelliJ or process
 * plumbing so it can be driven deterministically in tests.
 *
 * It owns everything about "one stdout stream, four message types in, two out":
 *
 *   - **demux** the single sidecar stream by `type` — `hello` (handshake),
 *     `response` (a webview request's reply), `progress`/`dataReady` (global
 *     pushes), `host-request` (sidecar -> host, e.g. the trust methods);
 *   - **correlate** webview requests across *all* windows. Each window's webview
 *     numbers its own RPC ids from 1, so ids collide between windows; the
 *     supervisor rewrites each forwarded id to a globally-unique one and routes
 *     the `response` back to the originating client with its original id;
 *   - **broadcast** `progress`/`dataReady` to every live client (all windows
 *     share the one sidecar and the one global dataset, decision D4);
 *   - **answer** `host-request`s by delegating to the injected [TrustStore]
 *     (decision D5: rule-approval authority lives on the Kotlin host). A
 *     `host-request` is fully consumed here and never leaks into a webview;
 *   - **supervise** the process: crash -> backoff restart up to [MAX_RESTARTS],
 *     with the counter reset after a stable run or a user-initiated restart.
 *
 * The transport (a real Node process) and scheduling are injected, so a test
 * drives crashes, lines, and clock advancement without spawning anything.
 */
class SidecarSupervisor(
    private val transportFactory: SidecarTransportFactory,
    private val scheduler: Scheduler,
    private val clock: () -> Long,
    private val trustStore: TrustStore = EmptyTrustStore,
    private val expectedProtocolVersion: String = EXPECTED_PROTOCOL_VERSION,
) : SidecarSink {

    /** A live consumer of sidecar output — one per open dashboard window. */
    interface Client {
        /** Stable identity used to namespace correlation ids and the registry. */
        val clientId: String
        fun onConnected(capabilities: JsonObject)
        fun onConnectionError(message: String)
        fun onResponse(originalId: String, data: JsonElement)
        fun onPush(message: JsonObject)
    }

    private val clients = LinkedHashMap<String, Client>()
    // correlationId -> (clientId, originalWebviewId)
    private val correlations = HashMap<String, Pair<String, String>>()
    // correlationId -> Kotlin callback, for host-originated requests ([hostCall])
    // whose responses are consumed by the host (e.g. the trust dialog) rather
    // than routed back to a webview.
    private val hostCalls = HashMap<String, (JsonElement) -> Unit>()
    private var correlationSeq = 0L

    private var transport: SidecarTransport? = null
    private var pendingRestart: Cancellable? = null
    private var restartCount = 0
    private var startedAt = 0L
    private var stopping = false

    private var connected = false
    private var capabilities: JsonObject = JsonObject()
    private var fatalMessage: String? = null

    // ---- lifecycle -------------------------------------------------------

    /** Start (or restart) the sidecar process. Idempotent while one is live. */
    @Synchronized
    fun start() {
        if (transport != null) return
        stopping = false
        fatalMessage = null
        connected = false
        startedAt = clock()
        transport = transportFactory.start(this)
    }

    /** Stop the sidecar for good (IDE/app shutdown). Closes stdin first so the
     *  sidecar exits on its own (the orphan-prevention contract), then this
     *  supervisor will not restart it. */
    @Synchronized
    fun stop() {
        stopping = true
        pendingRestart?.cancel()
        pendingRestart = null
        transport?.terminate()
        transport = null
    }

    /** User-initiated "Restart sidecar": clears the backoff budget and restarts
     *  immediately, regardless of how many crashes preceded it. */
    @Synchronized
    fun requestRestart() {
        restartCount = 0
        fatalMessage = null
        pendingRestart?.cancel()
        pendingRestart = null
        transport?.terminate()
        transport = null
        start()
    }

    // ---- client registry -------------------------------------------------

    @Synchronized
    fun registerClient(client: Client) {
        clients[client.clientId] = client
        // A window opened after the handshake (or after a fatal error) must see
        // the current state immediately rather than waiting for the next event.
        when {
            fatalMessage != null -> client.onConnectionError(fatalMessage!!)
            connected -> client.onConnected(capabilities)
        }
    }

    @Synchronized
    fun unregisterClient(client: Client) {
        clients.remove(client.clientId)
        correlations.entries.removeIf { it.value.first == client.clientId }
    }

    // ---- webview -> sidecar ---------------------------------------------

    /** Forward a (non-intercepted) webview request to the sidecar, namespacing
     *  its id so the reply routes back to [client] with [originalId]. */
    @Synchronized
    fun forward(
        client: Client,
        originalId: String,
        method: String,
        params: JsonObject?,
        scope: RequestScope,
    ) {
        val correlationId = "c${correlationSeq++}"
        correlations[correlationId] = client.clientId to originalId
        send(requestEnvelope(correlationId, method, params, scope))
    }

    /** Issue a host-originated request (e.g. the trust dialog asking the sidecar
     *  for the pending list) and deliver its `response` data to [onResult]
     *  instead of any webview. [onResult] runs on the supervisor's stream thread
     *  while holding the supervisor lock — keep it light (marshal to the EDT). */
    @Synchronized
    fun hostCall(
        method: String,
        params: JsonObject?,
        projectRoot: String?,
        safeMode: Boolean,
        onResult: (JsonElement) -> Unit,
    ) {
        if (!connected) {
            onResult(JsonObject().apply { addProperty("error", "sidecar not connected") })
            return
        }
        val correlationId = "k${correlationSeq++}"
        hostCalls[correlationId] = onResult
        // Host-originated calls never carry an inference provider.
        send(requestEnvelope(correlationId, method, params, RequestScope(projectRoot, safeMode)))
    }

    private fun requestEnvelope(
        id: String,
        method: String,
        params: JsonObject?,
        scope: RequestScope,
    ): JsonObject = JsonObject().apply {
        addProperty("type", "request")
        addProperty("id", id)
        addProperty("method", method)
        if (params != null) add("params", params)
        // The sidecar consumes this as a filesystem directory (getProjectRulesDir);
        // it must be the project's absolute root path, never an IDE project id.
        if (!scope.projectRoot.isNullOrBlank()) addProperty("projectRoot", scope.projectRoot)
        // Untrusted (safe-mode) projects get their project rule/metric layer
        // hard-blocked in the sidecar regardless of per-file approval (D5).
        addProperty("safeMode", scope.safeMode)
        // The inference provider, stamped only when one is active + consented; the
        // sidecar invokes whatever this names (cli-provider plan / ADR 0009).
        scope.provider?.let { provider ->
            add(
                "provider",
                JsonObject().apply {
                    addProperty("id", provider.id)
                    addProperty("binaryPath", provider.binaryPath)
                },
            )
        }
    }

    // ---- sidecar -> host (SidecarSink) ----------------------------------

    @Synchronized
    override fun onLine(line: String) {
        val message = parse(line) ?: return
        when (message.get("type")?.asStringOrNull()) {
            "hello" -> handleHello(message)
            "response" -> handleResponse(message)
            "progress", "dataReady" -> broadcast(message)
            "host-request" -> handleHostRequest(message)
            else -> Unit // unknown type: ignore (forward-compatible)
        }
    }

    @Synchronized
    override fun onExit(code: Int) {
        transport = null
        connected = false
        // Correlations don't survive a restart: fail any in-flight host calls so
        // a host caller (e.g. the trust dialog) gets an error instead of hanging.
        failHostCalls()
        if (stopping) return

        val uptime = clock() - startedAt
        if (uptime > STABLE_RUN_MS) restartCount = 0 // a stable run earns a fresh budget

        if (restartCount >= MAX_RESTARTS) {
            fatalMessage = "The AI Usage Coach sidecar crashed repeatedly (exit $code). " +
                "Use \"Restart sidecar\" to try again or view the logs."
            broadcastError(fatalMessage!!)
            return
        }
        restartCount++
        val delay = BACKOFF_BASE_MS shl (restartCount - 1)
        pendingRestart = scheduler.schedule(delay) {
            synchronized(this) {
                pendingRestart = null
                if (!stopping) start()
            }
        }
    }

    private fun handleHello(message: JsonObject) {
        val version = message.get("version")?.asStringOrNull()
        if (version != expectedProtocolVersion) {
            fatalMessage = "AI Usage Coach sidecar protocol mismatch: expected " +
                "$expectedProtocolVersion, got ${version ?: "none"}."
            broadcastError(fatalMessage!!)
            // Don't proceed on a mismatch — surface it instead of risking a
            // subtly-wrong wire contract.
            stop()
            return
        }
        connected = true
        fatalMessage = null
        capabilities = message.getAsJsonObjectOrEmpty("capabilities")
        for (client in clients.values.toList()) client.onConnected(capabilities)
    }

    private fun handleResponse(message: JsonObject) {
        val correlationId = message.get("id")?.asStringOrNull() ?: return
        val data = message.get("data") ?: JsonObject()
        // Host-originated calls ([hostCall]) are consumed by the host, never a webview.
        hostCalls.remove(correlationId)?.let { it(data); return }
        val (clientId, originalId) = correlations.remove(correlationId) ?: return
        val client = clients[clientId] ?: return
        client.onResponse(originalId, data)
    }

    private fun handleHostRequest(message: JsonObject) {
        val id = message.get("id")?.asStringOrNull() ?: return
        val method = message.get("method")?.asStringOrNull()
        val params = message.get("params")?.takeIf { it.isJsonObject }?.asJsonObject
        // Trust authority lives on the Kotlin host (decision D5): delegate to the
        // injected [TrustStore]. A host-request is fully consumed here so it can
        // never leak into a webview.
        val data: JsonElement = when (method) {
            "trust/get" -> trustStore.snapshot()
            "trust/update" -> {
                val key = params?.get("key")?.asStringOrNull()
                val value = params?.get("value")
                if (key != null && value != null) trustStore.put(key, value)
                JsonObject().apply { addProperty("ok", true) }
            }
            else -> JsonObject().apply { addProperty("ok", false) }
        }
        val reply = JsonObject().apply {
            addProperty("type", "host-response")
            addProperty("id", id)
            add("data", data)
        }
        send(reply)
    }

    /** Resolve every pending host call with an error so callers never hang when
     *  the sidecar dies (the sidecar side has its own timeout; the host didn't). */
    private fun failHostCalls() {
        if (hostCalls.isEmpty()) return
        val pending = HashMap(hostCalls)
        hostCalls.clear()
        val error = JsonObject().apply { addProperty("error", "sidecar disconnected") }
        for (cb in pending.values) cb(error)
    }

    private fun broadcast(message: JsonObject) {
        for (client in clients.values.toList()) client.onPush(message)
    }

    private fun broadcastError(message: String) {
        for (client in clients.values.toList()) client.onConnectionError(message)
    }

    private fun send(message: JsonObject) {
        transport?.send(message.toString())
    }

    // ---- helpers ---------------------------------------------------------

    private fun parse(line: String): JsonObject? = runCatching {
        JsonParser.parseString(line).takeIf { it.isJsonObject }?.asJsonObject
    }.getOrNull()

    private fun JsonElement.asStringOrNull(): String? =
        if (isJsonPrimitive && asJsonPrimitive.isString) asString else null

    private fun JsonObject.getAsJsonObjectOrEmpty(key: String): JsonObject =
        get(key)?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()

    companion object {
        const val EXPECTED_PROTOCOL_VERSION = "1.0.0"
        const val MAX_RESTARTS = 3
        const val STABLE_RUN_MS = 30_000L
        const val BACKOFF_BASE_MS = 500L
    }
}

/**
 * Everything stamped onto an outgoing RPC envelope beyond the method + params:
 * the project root, the trust/safe-mode flag, and the optional CLI inference
 * provider. Bundled into one value object so adding a stamp (the provider) does
 * not grow the positional arg list of every forwarding hop (review I6).
 */
data class RequestScope(
    val projectRoot: String?,
    val safeMode: Boolean,
    val provider: ProviderStamp? = null,
)

/**
 * The resolved CLI inference provider stamped on the envelope — present only when
 * a provider is selected, egress-consented, and available. Mirrors the sidecar's
 * `provider: { id, binaryPath }` wire field (`rpc-server.ts` `parseProvider`).
 */
data class ProviderStamp(val id: String, val binaryPath: String)

/** A started sidecar transport (a Node child process in production). */
interface SidecarTransport {
    /** Write one already-serialized protocol line (no trailing newline needed). */
    fun send(line: String)

    /** Close stdin and kill the process tree — the supervisor is done with it. */
    fun terminate()
}

/** Starts a [SidecarTransport], delivering its framed output to [sink]. */
fun interface SidecarTransportFactory {
    fun start(sink: SidecarSink): SidecarTransport
}

/** Receives framed NDJSON lines and the process exit from a transport. */
interface SidecarSink {
    fun onLine(line: String)
    fun onExit(code: Int)
}

/**
 * The Kotlin-host rule-trust store the sidecar reaches over `trust/get` /
 * `trust/update` (decision D5). Kept as an interface here so the supervisor
 * stays free of any IntelliJ dependency and can be driven by a fake in tests;
 * the production binding ([com.aicoach.jetbrains.trust.TrustStoreService]) is
 * injected by [SidecarService].
 */
interface TrustStore {
    /** Full memento snapshot answering `trust/get`: `{ "<key>": <value>, ... }`. */
    fun snapshot(): JsonObject

    /** Persist one memento key/value from `trust/update`. */
    fun put(key: String, value: JsonElement)
}

/** Default trust store: nothing approved, updates accepted but dropped. Keeps
 *  the supervisor self-contained in tests that don't exercise persistence. */
object EmptyTrustStore : TrustStore {
    override fun snapshot(): JsonObject = JsonObject()
    override fun put(key: String, value: JsonElement) = Unit
}

/** A cancellable scheduled task. */
fun interface Cancellable {
    fun cancel()
}

/** Schedules delayed work off the EDT (a real one wraps the platform executor). */
fun interface Scheduler {
    fun schedule(delayMs: Long, task: () -> Unit): Cancellable
}
