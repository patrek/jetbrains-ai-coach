package com.aicoach.jetbrains.sidecar

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.KillableProcessHandler
import com.intellij.execution.process.ProcessEvent
import com.intellij.execution.process.ProcessListener
import com.intellij.execution.process.ProcessOutputTypes
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.Key
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Path

/**
 * The production [SidecarTransport]: a single Node child process plus the NDJSON
 * framing that turns its byte-chunked stdout into whole protocol lines.
 *
 * Threading: a `KillableProcessHandler` runs its own reader threads, so the
 * supervisor never blocks the EDT (decision: `waitFor` on the EDT is an error on
 * 2026.1+). stdout chunks are line-buffered here; stderr is teed to the log.
 *
 * Orphan prevention: [terminate] closes stdin first — the sidecar's contract is
 * to exit when stdin closes — then kills the whole tree as a backstop (the parse
 * worker is a forked child).
 */
class SidecarProcess(
    commandLine: GeneralCommandLine,
    private val sink: SidecarSink,
    private val logSink: (String) -> Unit,
) : SidecarTransport {

    private val handler = KillableProcessHandler(commandLine)
    private val stdout = StringBuilder()

    init {
        handler.setShouldDestroyProcessRecursively(true)
        handler.addProcessListener(object : ProcessListener {
            override fun onTextAvailable(event: ProcessEvent, outputType: Key<*>) {
                when (outputType) {
                    ProcessOutputTypes.STDOUT -> frameStdout(event.text)
                    ProcessOutputTypes.STDERR -> logSink(event.text)
                    else -> Unit
                }
            }

            override fun processTerminated(event: ProcessEvent) {
                emitTrailingLine()
                sink.onExit(event.exitCode)
            }
        })
        handler.startNotify()
    }

    /** The OS pid, available after the process is spawned (for the orphan sweep). */
    fun pid(): Long? = runCatching { handler.process.pid() }.getOrNull()

    @Synchronized
    private fun frameStdout(text: String) {
        stdout.append(text)
        var newline = stdout.indexOf("\n")
        while (newline >= 0) {
            val line = stdout.substring(0, newline).trimEnd('\r')
            stdout.delete(0, newline + 1)
            if (line.isNotBlank()) sink.onLine(line)
            newline = stdout.indexOf("\n")
        }
    }

    /** Flush any unterminated trailing output as a final line on exit. */
    @Synchronized
    private fun emitTrailingLine() {
        val line = stdout.toString().trimEnd('\r', '\n')
        stdout.setLength(0)
        if (line.isNotBlank()) sink.onLine(line)
    }

    override fun send(line: String) {
        val input = handler.processInput ?: return
        try {
            synchronized(input) {
                input.write((line + "\n").toByteArray(StandardCharsets.UTF_8))
                input.flush()
            }
        } catch (e: Exception) {
            log.debug("Failed to write to sidecar stdin (process likely gone)", e)
        }
    }

    override fun terminate() {
        // Close stdin first: the sidecar exits on its own (the orphan contract),
        // flushing in flight. The tree kill is the backstop if it doesn't.
        runCatching { handler.processInput?.close() }
        handler.killProcess()
    }

    companion object {
        private val log = logger<SidecarProcess>()
    }
}

/**
 * Builds a [SidecarProcess] for each (re)start. The node path and extracted
 * `main.js` are resolved once by [SidecarService] before the first start; the
 * working directory is the runtime dir so the bundle finds its `rules/` and
 * `metrics/` siblings.
 *
 * [excludedDirs] are forwarded as the `AI_COACH_EXCLUDED_DIRS` environment
 * variable (the platform path separator joins them). The sidecar — and the parse
 * worker it spawns, which inherits this environment — skips these directories so
 * they are never read.
 */
class SidecarProcessFactory(
    private val nodePath: String,
    private val mainJs: Path,
    private val excludedDirs: List<String>,
    private val onPid: (Long?) -> Unit,
    private val logSink: (String) -> Unit,
) : SidecarTransportFactory {

    override fun start(sink: SidecarSink): SidecarTransport {
        val commandLine = GeneralCommandLine(nodePath, mainJs.toString())
            .withWorkDirectory(mainJs.parent.toFile())
        if (excludedDirs.isNotEmpty()) {
            commandLine.withEnvironment(EXCLUDED_DIRS_ENV, excludedDirs.joinToString(File.pathSeparator))
        }
        val process = SidecarProcess(commandLine, sink, logSink)
        onPid(process.pid())
        return process
    }

    companion object {
        /** Mirror of the sidecar's `dir-exclusion.ts` env contract. */
        const val EXCLUDED_DIRS_ENV = "AI_COACH_EXCLUDED_DIRS"
    }
}
