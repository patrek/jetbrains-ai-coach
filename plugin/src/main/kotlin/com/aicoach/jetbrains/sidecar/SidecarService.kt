package com.aicoach.jetbrains.sidecar

import com.google.gson.JsonObject
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.util.concurrency.AppExecutorUtil
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.util.concurrent.TimeUnit

/**
 * The one application-level sidecar shared by every IDE window (decision D4).
 *
 * This is the thin IntelliJ adapter around [SidecarSupervisor]: it supplies the
 * real process transport, a platform-backed scheduler, the log sink, and the
 * version-stamped runtime extraction. All protocol and supervision policy lives
 * in the (platform-free, unit-tested) supervisor.
 *
 * Lifecycle: the first dashboard window to resolve Node calls [ensureStarted];
 * later windows register as [SidecarSupervisor.Client]s and share the running
 * process. On app shutdown [dispose] closes stdin so the sidecar exits cleanly.
 */
@Service(Service.Level.APP)
class SidecarService : Disposable {

    private data class Launch(val nodePath: String, val mainJs: Path)

    @Volatile
    private var launch: Launch? = null
    private var started = false

    private val supervisor = SidecarSupervisor(
        transportFactory = SidecarTransportFactory { sink ->
            val cfg = launch ?: error("Sidecar launch configuration not set")
            SidecarProcessFactory(cfg.nodePath, cfg.mainJs, SidecarRuntime::recordPid, ::appendLog).start(sink)
        },
        scheduler = { delayMs, task ->
            val future = AppExecutorUtil.getAppScheduledExecutorService()
                .schedule(task, delayMs, TimeUnit.MILLISECONDS)
            Cancellable { future.cancel(false) }
        },
        clock = System::currentTimeMillis,
    )

    /**
     * Start the sidecar once, with a Node path the caller already validated via
     * [NodeDetector]. Idempotent: extra calls (other windows) are no-ops. Does
     * the runtime extraction and stale-process sweep before the first launch.
     */
    @Synchronized
    fun ensureStarted(nodePath: String) {
        if (started) return
        started = true
        val mainJs = SidecarRuntime.ensureExtracted(pluginVersion())
        SidecarRuntime.sweepStaleProcess()
        launch = Launch(nodePath, mainJs)
        supervisor.start()
    }

    fun register(client: SidecarSupervisor.Client) = supervisor.registerClient(client)

    fun unregister(client: SidecarSupervisor.Client) = supervisor.unregisterClient(client)

    fun forward(
        client: SidecarSupervisor.Client,
        originalId: String,
        method: String,
        params: JsonObject?,
        projectRoot: String?,
    ) = supervisor.forward(client, originalId, method, params, projectRoot)

    /** User-initiated "Restart sidecar": clears the backoff budget. */
    fun requestRestart() = supervisor.requestRestart()

    override fun dispose() {
        supervisor.stop()
    }

    private fun appendLog(text: String) {
        runCatching {
            Files.createDirectories(SidecarRuntime.logFile.parent)
            Files.writeString(
                SidecarRuntime.logFile,
                text,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND,
            )
        }.onFailure { log.warn("Could not append to sidecar log", it) }
    }

    private fun pluginVersion(): String =
        PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID))?.version ?: "dev"

    companion object {
        private const val PLUGIN_ID = "com.aicoach.jetbrains"
        private val log = logger<SidecarService>()

        fun getInstance(): SidecarService =
            ApplicationManager.getApplication().getService(SidecarService::class.java)
    }
}
