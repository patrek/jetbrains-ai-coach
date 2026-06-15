package com.aicoach.jetbrains.sidecar

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Drives [SidecarSupervisor]'s protocol and lifecycle policy with fakes — no
 * Node process, no IntelliJ platform, no real clock. Covers the demux,
 * cross-window correlation, broadcast, the stubbed trust router, and the
 * crash/backoff/reset supervision rules.
 */
class SidecarSupervisorTest {

    private lateinit var transports: FakeTransportFactory
    private lateinit var scheduler: FakeScheduler
    private var now = 1_000L
    private lateinit var supervisor: SidecarSupervisor

    @Before
    fun setUp() {
        transports = FakeTransportFactory()
        scheduler = FakeScheduler()
        now = 1_000L
        supervisor = SidecarSupervisor(transports, scheduler, clock = { now })
    }

    @Test
    fun `handshake connects registered clients with capabilities`() {
        val client = RecordingClient("w1")
        supervisor.registerClient(client)
        supervisor.start()

        transports.deliver(hello(caps = """{"llm":false,"github":true}"""))

        assertEquals(1, client.connected.size)
        assertEquals(true, client.connected.single().get("github").asBoolean)
    }

    @Test
    fun `a client registered after the handshake connects immediately`() {
        supervisor.start()
        transports.deliver(hello())

        val late = RecordingClient("late")
        supervisor.registerClient(late)

        assertEquals(1, late.connected.size)
    }

    @Test
    fun `protocol version mismatch surfaces an error and stops the sidecar`() {
        val client = RecordingClient("w1")
        supervisor.registerClient(client)
        supervisor.start()

        transports.deliver("""{"type":"hello","version":"9.9.9","capabilities":{}}""")

        assertTrue(client.errors.single().contains("protocol mismatch"))
        assertTrue("a mismatched sidecar must be terminated", transports.latest().terminated)
        // No restart scheduled — a mismatch is fatal, not a crash.
        assertEquals(0, scheduler.pending.size)
    }

    @Test
    fun `responses route to the originating client by original id across windows`() {
        val w1 = RecordingClient("w1")
        val w2 = RecordingClient("w2")
        supervisor.registerClient(w1)
        supervisor.registerClient(w2)
        supervisor.start()
        transports.deliver(hello())

        // Both windows independently number their first request "1".
        supervisor.forward(w1, originalId = "1", method = "getStats", params = null, projectRoot = "/a", safeMode = false)
        supervisor.forward(w2, originalId = "1", method = "getStats", params = null, projectRoot = "/b", safeMode = false)

        // Correlation ids are assigned in order: c0 -> w1, c1 -> w2.
        transports.deliver("""{"type":"response","id":"c1","data":{"for":"w2"}}""")
        transports.deliver("""{"type":"response","id":"c0","data":{"for":"w1"}}""")

        assertEquals("w1", w1.responses.single().second.asJsonObject.get("for").asString)
        assertEquals("1", w1.responses.single().first)
        assertEquals("w2", w2.responses.single().second.asJsonObject.get("for").asString)
    }

    @Test
    fun `forward stamps the project root as a path on a top-level field`() {
        val w1 = RecordingClient("w1")
        supervisor.registerClient(w1)
        supervisor.start()
        transports.deliver(hello())

        supervisor.forward(w1, "1", "saveRule", JsonObject().apply { addProperty("markdown", "x") }, "/home/u/proj", safeMode = false)

        val sent = JsonParser.parseString(transports.latest().sent.last()).asJsonObject
        assertEquals("request", sent.get("type").asString)
        assertEquals("/home/u/proj", sent.get("projectRoot").asString)
        assertEquals(false, sent.get("safeMode").asBoolean)
        assertEquals("x", sent.getAsJsonObject("params").get("markdown").asString)
    }

    @Test
    fun `forward stamps safeMode so the sidecar hard-blocks an untrusted project layer`() {
        val w1 = RecordingClient("w1")
        supervisor.registerClient(w1)
        supervisor.start()
        transports.deliver(hello())

        supervisor.forward(w1, "1", "getAntiPatterns", null, "/home/u/proj", safeMode = true)

        val sent = JsonParser.parseString(transports.latest().sent.last()).asJsonObject
        assertEquals(true, sent.get("safeMode").asBoolean)
    }

    @Test
    fun `trust host-requests delegate to the injected trust store`() {
        val store = RecordingTrustStore()
        val sup = SidecarSupervisor(transports, scheduler, { now }, trustStore = store)
        sup.registerClient(RecordingClient("w1"))
        sup.start()
        transports.deliver(hello())

        store.entries["aiEngineerCoach.ruleTrust.v1"] = JsonParser.parseString("""{"f":{"hash":"h"}}""")
        transports.deliver("""{"type":"host-request","id":"h0","method":"trust/get","params":{}}""")
        transports.deliver("""{"type":"host-request","id":"h1","method":"trust/update","params":{"key":"k","value":{"hash":"z"}}}""")

        val replies = transports.latest().sent.map { JsonParser.parseString(it).asJsonObject }
            .filter { it.get("type").asString == "host-response" }
        // trust/get returns the store snapshot.
        assertEquals("h", replies[0].getAsJsonObject("data").getAsJsonObject("aiEngineerCoach.ruleTrust.v1").get("f").asJsonObject.get("hash").asString)
        // trust/update wrote the key/value through to the store.
        assertEquals("z", store.entries["k"]?.asJsonObject?.get("hash")?.asString)
    }

    @Test
    fun `hostCall delivers the response to the caller, not a webview`() {
        val w1 = RecordingClient("w1")
        supervisor.registerClient(w1)
        supervisor.start()
        transports.deliver(hello())

        var received: com.google.gson.JsonElement? = null
        supervisor.hostCall("getLocalRulesPending", null, "/proj", safeMode = false) { received = it }

        // The request went out with a host-call correlation id (prefix 'k').
        val sent = JsonParser.parseString(transports.latest().sent.last()).asJsonObject
        val id = sent.get("id").asString
        assertEquals("getLocalRulesPending", sent.get("method").asString)
        transports.deliver("""{"type":"response","id":"$id","data":{"pending":[]}}""")

        assertEquals(0, received!!.asJsonObject.getAsJsonArray("pending").size())
        assertEquals(0, w1.responses.size) // never reached the webview
    }

    @Test
    fun `hostCall fails fast when the sidecar is not connected`() {
        supervisor.start() // started but no hello delivered yet -> not connected

        var received: JsonElement? = null
        supervisor.hostCall("getLocalRulesPending", null, "/proj", safeMode = false) { received = it }

        // The caller is answered synchronously with an error, never left hanging.
        assertTrue(received!!.asJsonObject.has("error"))
    }

    @Test
    fun `a crash fails in-flight host calls instead of hanging the caller`() {
        supervisor.registerClient(RecordingClient("w1"))
        supervisor.start()
        transports.deliver(hello())

        var received: JsonElement? = null
        supervisor.hostCall("getLocalRulesPending", null, null, safeMode = false) { received = it }
        // No response arrives; the sidecar crashes.
        supervisor.onExit(1)

        assertTrue(received!!.asJsonObject.has("error"))
    }

    @Test
    fun `progress and dataReady broadcast to every live client`() {
        val w1 = RecordingClient("w1")
        val w2 = RecordingClient("w2")
        supervisor.registerClient(w1)
        supervisor.registerClient(w2)
        supervisor.start()
        transports.deliver(hello())

        transports.deliver("""{"type":"progress","phase":1,"pct":50}""")
        transports.deliver("""{"type":"dataReady","currentWorkspace":""}""")

        assertEquals(2, w1.pushes.size)
        assertEquals(2, w2.pushes.size)
    }

    @Test
    fun `host-request is answered on the wire and never delivered to a client`() {
        val w1 = RecordingClient("w1")
        supervisor.registerClient(w1)
        supervisor.start()
        transports.deliver(hello())

        transports.deliver("""{"type":"host-request","id":"h0","method":"trust/get","params":{}}""")
        transports.deliver("""{"type":"host-request","id":"h1","method":"trust/update","params":{}}""")

        val replies = transports.latest().sent.map { JsonParser.parseString(it).asJsonObject }
            .filter { it.get("type").asString == "host-response" }
        assertEquals("h0", replies[0].get("id").asString)
        assertEquals(0, replies[0].getAsJsonObject("data").size()) // trust/get -> {}
        assertEquals(true, replies[1].getAsJsonObject("data").get("ok").asBoolean) // trust/update -> ack
        // None of it reached the webview.
        assertEquals(0, w1.pushes.size)
        assertEquals(0, w1.responses.size)
    }

    @Test
    fun `a crash schedules a backoff restart`() {
        supervisor.start()
        transports.deliver(hello())
        val firstStarts = transports.startCount

        supervisor.onExit(code = 1)
        assertEquals("one restart should be scheduled", 1, scheduler.pending.size)
        assertEquals(SidecarSupervisor.BACKOFF_BASE_MS, scheduler.pending.single().delay)

        scheduler.runNext()
        assertEquals(firstStarts + 1, transports.startCount)
    }

    @Test
    fun `repeated crashes stop after the restart budget and report a fatal error`() {
        val client = RecordingClient("w1")
        supervisor.registerClient(client)
        supervisor.start()
        transports.deliver(hello())

        // Three crashes within the stable window exhaust the budget.
        repeat(SidecarSupervisor.MAX_RESTARTS) {
            supervisor.onExit(1)
            scheduler.runNext()
        }
        // The fourth crash is fatal: no further restart, an error is broadcast.
        supervisor.onExit(1)

        assertEquals(0, scheduler.pending.size)
        assertTrue(client.errors.last().contains("crashed repeatedly"))
    }

    @Test
    fun `a stable run resets the restart budget`() {
        supervisor.start()
        transports.deliver(hello())

        // Two quick crashes...
        supervisor.onExit(1); scheduler.runNext()
        supervisor.onExit(1); scheduler.runNext()

        // ...then a run that stays up beyond the stable threshold.
        now += SidecarSupervisor.STABLE_RUN_MS + 1
        supervisor.onExit(1)

        // Budget was reset by the stable run, so this counts as restart #1 again.
        assertEquals(SidecarSupervisor.BACKOFF_BASE_MS, scheduler.pending.single().delay)
    }

    @Test
    fun `user restart clears the budget and restarts immediately`() {
        val client = RecordingClient("w1")
        supervisor.registerClient(client)
        supervisor.start()
        transports.deliver(hello())
        repeat(SidecarSupervisor.MAX_RESTARTS) { supervisor.onExit(1); scheduler.runNext() }
        supervisor.onExit(1) // fatal
        assertTrue(client.errors.isNotEmpty())

        val before = transports.startCount
        supervisor.requestRestart()

        assertEquals("restart is immediate, not scheduled", before + 1, transports.startCount)
        assertEquals(0, scheduler.pending.size)
    }

    @Test
    fun `stop closes the transport and suppresses restarts`() {
        supervisor.start()
        transports.deliver(hello())
        supervisor.stop()

        assertTrue(transports.latest().terminated)
        supervisor.onExit(0) // exit after a deliberate stop
        assertEquals("no restart after an intentional stop", 0, scheduler.pending.size)
    }

    @Test
    fun `unregistering a client drops its pending correlations`() {
        val w1 = RecordingClient("w1")
        supervisor.registerClient(w1)
        supervisor.start()
        transports.deliver(hello())
        supervisor.forward(w1, "1", "getStats", null, null, safeMode = false)

        supervisor.unregisterClient(w1)
        // A late response for the gone window is simply dropped (no crash).
        transports.deliver("""{"type":"response","id":"c0","data":{}}""")
        assertEquals(0, w1.responses.size)
    }

    // ---- fakes -----------------------------------------------------------

    private fun hello(version: String = "1.0.0", caps: String = "{}"): String =
        """{"type":"hello","version":"$version","capabilities":$caps}"""

    private class RecordingClient(override val clientId: String) : SidecarSupervisor.Client {
        val connected = mutableListOf<JsonObject>()
        val errors = mutableListOf<String>()
        val responses = mutableListOf<Pair<String, JsonElement>>()
        val pushes = mutableListOf<JsonObject>()
        override fun onConnected(capabilities: JsonObject) { connected += capabilities }
        override fun onConnectionError(message: String) { errors += message }
        override fun onResponse(originalId: String, data: JsonElement) { responses += originalId to data }
        override fun onPush(message: JsonObject) { pushes += message }
    }

    private class RecordingTrustStore : TrustStore {
        val entries = mutableMapOf<String, JsonElement>()
        override fun snapshot(): JsonObject = JsonObject().apply { entries.forEach { (k, v) -> add(k, v) } }
        override fun put(key: String, value: JsonElement) { entries[key] = value }
    }

    private class FakeTransport(val sink: SidecarSink) : SidecarTransport {
        val sent = mutableListOf<String>()
        var terminated = false
        override fun send(line: String) { sent += line }
        override fun terminate() { terminated = true }
    }

    private class FakeTransportFactory : SidecarTransportFactory {
        private val all = mutableListOf<FakeTransport>()
        var startCount = 0
        override fun start(sink: SidecarSink): SidecarTransport {
            startCount++
            return FakeTransport(sink).also { all += it }
        }
        fun latest(): FakeTransport = all.last()
        /** Feed a line to the current transport's sink. */
        fun deliver(line: String) = latest().sink.onLine(line)
    }

    private class FakeScheduler : Scheduler {
        data class Task(val delay: Long, val run: () -> Unit) : Cancellable {
            var cancelled = false
            override fun cancel() { cancelled = true }
        }
        val pending = mutableListOf<Task>()
        override fun schedule(delayMs: Long, task: () -> Unit): Cancellable =
            Task(delayMs, task).also { pending += it }
        /** Run the next scheduled task (simulating its delay elapsing). */
        fun runNext() {
            val task = pending.removeAt(0)
            if (!task.cancelled) task.run()
        }
    }
}
