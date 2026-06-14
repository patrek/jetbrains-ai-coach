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
 *   - **answer** `host-request`s via the stubbed trust router (decision D5; the
 *     real [com.aicoach.jetbrains] trust store lands in part 5);
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
    fun forward(client: Client, originalId: String, method: String, params: JsonObject?, projectRoot: String?) {
        val correlationId = "c${correlationSeq++}"
        correlations[correlationId] = client.clientId to originalId
        val envelope = JsonObject().apply {
            addProperty("type", "request")
            addProperty("id", correlationId)
            addProperty("method", method)
            if (params != null) add("params", params)
            // The sidecar consumes this as a filesystem directory (getProjectRulesDir);
            // it must be the project's absolute root path, never an IDE project id.
            if (!projectRoot.isNullOrBlank()) addProperty("projectRoot", projectRoot)
        }
        send(envelope)
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
        if (stopping) return

        val uptime = clock() - startedAt
        if (uptime > STABLE_RUN_MS) restartCount = 0 // a stable run earns a fresh budget

        if (restartCount >= MAX_RESTARTS) {
            fatalMessage = "The AI Coach sidecar crashed repeatedly (exit $code). " +
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
            fatalMessage = "AI Coach sidecar protocol mismatch: expected " +
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
        val (clientId, originalId) = correlations.remove(correlationId) ?: return
        val client = clients[clientId] ?: return
        client.onResponse(originalId, message.get("data") ?: JsonObject())
    }

    private fun handleHostRequest(message: JsonObject) {
        val id = message.get("id")?.asStringOrNull() ?: return
        val method = message.get("method")?.asStringOrNull()
        // Stubbed trust router (decision D5). Until TrustStoreService lands in
        // part 5: report nothing trusted, ack updates. A host-request must never
        // leak into a webview, so it is fully consumed here.
        val data: JsonElement = when (method) {
            "trust/get" -> JsonObject()
            "trust/update" -> JsonObject().apply { addProperty("ok", true) }
            else -> JsonObject().apply { addProperty("ok", false) }
        }
        val reply = JsonObject().apply {
            addProperty("type", "host-response")
            addProperty("id", id)
            add("data", data)
        }
        send(reply)
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

/** A cancellable scheduled task. */
fun interface Cancellable {
    fun cancel()
}

/** Schedules delayed work off the EDT (a real one wraps the platform executor). */
fun interface Scheduler {
    fun schedule(delayMs: Long, task: () -> Unit): Cancellable
}
