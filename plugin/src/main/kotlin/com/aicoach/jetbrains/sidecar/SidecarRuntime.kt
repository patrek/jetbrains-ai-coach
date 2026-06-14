package com.aicoach.jetbrains.sidecar

import com.intellij.openapi.diagnostic.logger
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.zip.ZipFile

/**
 * On-disk layout and lifecycle for the extracted Node runtime.
 *
 * The plugin ships the sidecar bundle inside its JAR (under `/sidecar`); Node can't
 * run code from inside a JAR, so it is extracted to a **version-stamped** dir
 * under the user home. Version-stamping means a plugin update never launches a
 * stale bundle. Part 3 launches the extracted `main.js` directly; the stable
 * `runtime/current` indirection is deferred to part 5 (its only consumer, the
 * MCP external config, doesn't exist yet).
 *
 *   ~/.ai-coach-jetbrains/
 *     logs/sidecar.log              # stderr + supervisor notes
 *     runtime/sidecar.pid           # last sidecar pid (stale-orphan sweep)
 *     runtime/<pluginVersion>/      # extracted main.js + workers + rules/ + metrics/
 */
object SidecarRuntime {

    private val log = logger<SidecarRuntime>()

    /** Files that must be present for an extraction to count as complete. */
    private val REQUIRED = listOf("main.js", "parse-worker.js", "warm-up-worker.js", "cache-write-worker.js")

    val baseDir: Path = Paths.get(System.getProperty("user.home"), ".ai-coach-jetbrains")
    val logFile: Path = baseDir.resolve("logs/sidecar.log")
    private val runtimeBase: Path = baseDir.resolve("runtime")
    private val pidFile: Path = runtimeBase.resolve("sidecar.pid")

    fun versionDir(pluginVersion: String): Path = runtimeBase.resolve(pluginVersion)

    /**
     * Ensure the bundle for [pluginVersion] is extracted and return its
     * `main.js`. A complete prior extraction is reused; an incomplete one is
     * re-extracted. The bundle lives under `/sidecar/` in the plugin classpath
     * (a JAR in production, a directory in a dev sandbox).
     */
    fun ensureExtracted(pluginVersion: String): Path {
        val target = versionDir(pluginVersion)
        val mainJs = target.resolve("main.js")
        if (isComplete(target)) return mainJs

        Files.createDirectories(target)
        Files.createDirectories(logFile.parent)
        extractBundle(target)
        if (!isComplete(target)) {
            error("Sidecar bundle extraction incomplete in $target (missing one of $REQUIRED)")
        }
        return mainJs
    }

    private fun isComplete(dir: Path): Boolean = REQUIRED.all { Files.isRegularFile(dir.resolve(it)) }

    /** Copy every classpath resource under `sidecar/` into [target], flattening the
     *  `sidecar/` prefix so `main.js` lands at the runtime root. */
    private fun extractBundle(target: Path) {
        val location = javaClass.protectionDomain.codeSource?.location
            ?: error("Cannot locate the plugin code source to extract the sidecar bundle")
        val source = Paths.get(location.toURI())

        if (Files.isDirectory(source)) {
            val sidecarDir = source.resolve("sidecar")
            if (!Files.isDirectory(sidecarDir)) error("No /sidecar resources under $source")
            Files.walk(sidecarDir).use { stream ->
                stream.filter { Files.isRegularFile(it) }.forEach { file ->
                    copyInto(target, sidecarDir.relativize(file).toString(), Files.newInputStream(file))
                }
            }
        } else {
            ZipFile(source.toFile()).use { zip ->
                zip.entries().asSequence()
                    .filter { !it.isDirectory && it.name.startsWith("sidecar/") }
                    .forEach { entry ->
                        zip.getInputStream(entry).use { input ->
                            copyInto(target, entry.name.removePrefix("sidecar/"), input)
                        }
                    }
            }
        }
    }

    private fun copyInto(target: Path, relativePath: String, input: java.io.InputStream) {
        val dest = target.resolve(relativePath)
        Files.createDirectories(dest.parent)
        input.use { Files.copy(it, dest, java.nio.file.StandardCopyOption.REPLACE_EXISTING) }
    }

    /**
     * Best-effort orphan sweep: if a prior IDE crashed (didn't close the
     * sidecar's stdin), its Node may still be alive. Kill the pid we recorded
     * last time before launching a fresh one. Guarded so we never kill an
     * unrelated process that merely reused the pid.
     */
    fun sweepStaleProcess() {
        val recorded = runCatching { Files.readString(pidFile).trim().toLong() }.getOrNull() ?: return
        val handle = ProcessHandle.of(recorded).orElse(null)
        if (handle != null && handle.isAlive && looksLikeSidecar(handle)) {
            log.info("Sweeping stale sidecar process pid=$recorded")
            handle.destroy()
        }
        runCatching { Files.deleteIfExists(pidFile) }
    }

    private fun looksLikeSidecar(handle: ProcessHandle): Boolean {
        val command = handle.info().command().orElse("")
        val commandLine = handle.info().commandLine().orElse("")
        // Only ours: a node process whose command line references our runtime dir.
        return command.contains("node", ignoreCase = true) &&
            (commandLine.contains(runtimeBase.toString()) || commandLine.isEmpty())
    }

    fun recordPid(pid: Long?) {
        if (pid == null) return
        runCatching {
            Files.createDirectories(runtimeBase)
            Files.writeString(pidFile, pid.toString())
        }.onFailure { log.warn("Could not record sidecar pid", it) }
    }
}
