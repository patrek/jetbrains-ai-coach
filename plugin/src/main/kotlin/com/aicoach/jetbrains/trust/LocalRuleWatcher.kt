package com.aicoach.jetbrains.trust

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.util.concurrency.AppExecutorUtil
import java.nio.file.FileSystems
import java.nio.file.Path
import java.nio.file.StandardWatchEventKinds
import java.nio.file.WatchKey
import java.nio.file.WatchService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Watches the personal and project rule/metric directories for edits so the
 * trust gate can re-evaluate them (decision D5: editing an approved rule must
 * exclude it from the next run and re-list it as pending — its content hash no
 * longer matches the approved hash).
 *
 * The directories live outside the project content roots
 * (`~/.ai-engineer-coach/...` and `<root>/.ai-engineer-coach/...`), so a plain
 * `java.nio` [WatchService] on a daemon thread is used rather than the IDE VFS.
 * Bursty filesystem events (editors write a file several times) are coalesced
 * into a single [onChanged] call after [DEBOUNCE_MS].
 */
class LocalRuleWatcher(
    projectRoot: String?,
    private val onChanged: () -> Unit,
) : Disposable {

    private val dirs: List<Path> = buildList {
        val home = System.getProperty("user.home")
        if (home != null) {
            add(Path.of(home, ".ai-engineer-coach", "rules"))
            add(Path.of(home, ".ai-engineer-coach", "metrics"))
        }
        if (!projectRoot.isNullOrBlank()) {
            add(Path.of(projectRoot, ".ai-engineer-coach", "rules"))
            add(Path.of(projectRoot, ".ai-engineer-coach", "metrics"))
        }
    }

    private val running = AtomicBoolean(false)
    @Volatile private var watchService: WatchService? = null
    @Volatile private var thread: Thread? = null
    @Volatile private var debounce: ScheduledFuture<*>? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        val service = runCatching { FileSystems.getDefault().newWatchService() }.getOrNull() ?: run {
            running.set(false)
            return
        }
        watchService = service
        var registered = 0
        for (dir in dirs) {
            runCatching {
                dir.register(
                    service,
                    StandardWatchEventKinds.ENTRY_MODIFY,
                    StandardWatchEventKinds.ENTRY_CREATE,
                    StandardWatchEventKinds.ENTRY_DELETE,
                )
                registered++
            }.onFailure { log.debug("Trust watcher: $dir not watchable (likely absent)", it) }
        }
        if (registered == 0) {
            // No local rule dirs exist yet. Don't strand an idle daemon thread on
            // a WatchService that can never fire; the next dashboard open re-checks
            // pending anyway. Re-evaluation resumes when dirs appear and a window
            // reopens (a fresh watcher registers them).
            log.debug("Trust watcher: no local rule directories present; not starting")
            runCatching { service.close() }
            watchService = null
            running.set(false)
            return
        }
        thread = Thread({ loop(service) }, "aicoach-trust-watcher").apply {
            isDaemon = true
            start()
        }
    }

    private fun loop(service: WatchService) {
        while (running.get()) {
            val key: WatchKey = try {
                service.take()
            } catch (_: InterruptedException) {
                return
            } catch (_: java.nio.file.ClosedWatchServiceException) {
                return
            }
            // Drain the events; we only care that *something* changed.
            key.pollEvents()
            key.reset()
            if (running.get()) scheduleNotify()
        }
    }

    private fun scheduleNotify() {
        debounce?.cancel(false)
        debounce = AppExecutorUtil.getAppScheduledExecutorService().schedule({
            if (running.get()) runCatching { onChanged() }.onFailure { log.warn("Trust watcher callback failed", it) }
        }, DEBOUNCE_MS, TimeUnit.MILLISECONDS)
    }

    override fun dispose() {
        if (!running.compareAndSet(true, false)) return
        debounce?.cancel(false)
        thread?.interrupt()
        runCatching { watchService?.close() }
        watchService = null
        thread = null
    }

    companion object {
        private const val DEBOUNCE_MS = 400L
        private val log = logger<LocalRuleWatcher>()
    }
}
