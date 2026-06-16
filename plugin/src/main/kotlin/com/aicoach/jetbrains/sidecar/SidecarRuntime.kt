package com.aicoach.jetbrains.sidecar

import com.intellij.openapi.diagnostic.logger
import java.net.URI
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
 * stale bundle. Part 3 launches the extracted `main.js` directly.
 *
 * The stable `runtime/current/` mirror (part 6) is what the standalone MCP
 * server's external client config points at
 * (`node ~/.ai-coach-jetbrains/runtime/current/mcp-main.js`, ADR 0002). It is a
 * plain copy of the active version dir — not a symlink, so it works on Windows
 * without the symlink privilege and with the IDE closed. It is refreshed
 * (guarded by the same bundle fingerprint) on every extraction, so a plugin
 * update transparently re-points `current` at the new bundle while the client
 * config path never changes.
 *
 *   ~/.ai-coach-jetbrains/
 *     logs/sidecar.log              # stderr + supervisor notes
 *     runtime/sidecar.pid           # last sidecar pid (stale-orphan sweep)
 *     runtime/<pluginVersion>/      # extracted main.js + workers + rules/ + metrics/
 *     runtime/current/              # mirror of the active version dir (MCP config target)
 */
object SidecarRuntime {

    private val log = logger<SidecarRuntime>()

    /** Files that must be present for an extraction to count as complete. */
    private val REQUIRED = listOf("main.js", "mcp-main.js", "parse-worker.js", "warm-up-worker.js", "cache-write-worker.js")

    /** Stores the SHA-256 of the bundled main.js the extraction was made from. */
    private const val FINGERPRINT_FILE = ".bundle-hash"

    val baseDir: Path = Paths.get(System.getProperty("user.home"), ".ai-coach-jetbrains")
    val logFile: Path = baseDir.resolve("logs/sidecar.log")
    private val runtimeBase: Path = baseDir.resolve("runtime")
    private val pidFile: Path = runtimeBase.resolve("sidecar.pid")

    /** Stable mirror of the active version dir; the MCP client config target. */
    val currentDir: Path = runtimeBase.resolve("current")

    /** The standalone MCP server entry the external client launches. */
    val mcpMainPath: Path = currentDir.resolve("mcp-main.js")

    fun versionDir(pluginVersion: String): Path = runtimeBase.resolve(pluginVersion)

    /**
     * Ensure the bundle for [pluginVersion] is extracted and return its
     * `main.js`. The extraction is reused only when it is complete **and** its
     * stored fingerprint matches the bundled `main.js`; otherwise it is
     * re-extracted.
     *
     * The fingerprint (not the version-stamped dir name) is the freshness key:
     * the dir name never changes in the Gradle dev sandbox between builds, and
     * the IntelliJ sandbox packages the plugin as a JAR (so a file://-vs-jar://
     * heuristic does not detect dev). Hashing the bundled `main.js` correctly
     * re-extracts on every rebuilt bundle (dev) and every plugin update (prod),
     * while reusing an unchanged one.
     */
    fun ensureExtracted(pluginVersion: String): Path {
        val target = versionDir(pluginVersion)
        val mainJs = target.resolve("main.js")
        val stamp = target.resolve(FINGERPRINT_FILE)
        val fingerprint = bundleFingerprint()
        val upToDate = isComplete(target) &&
            runCatching { Files.readString(stamp).trim() == fingerprint }.getOrDefault(false)
        if (upToDate) {
            mirrorToCurrent(target, fingerprint)
            return mainJs
        }

        Files.createDirectories(target)
        Files.createDirectories(logFile.parent)
        extractBundle(target)
        if (!isComplete(target)) {
            error("Sidecar bundle extraction incomplete in $target (missing one of $REQUIRED)")
        }
        runCatching { Files.writeString(stamp, fingerprint) }
            .onFailure { log.warn("Could not write bundle fingerprint", it) }
        mirrorToCurrent(target, fingerprint)
        return mainJs
    }

    /**
     * Refresh `runtime/current/` to mirror [source] so the external MCP config
     * path stays valid across plugin updates. Guarded by the bundle [fingerprint]
     * (stored in `current/.bundle-hash`) so it copies only when the bundle
     * changed. Best-effort: a failure here never blocks the IDE sidecar launch —
     * only the IDE-closed MCP path would be briefly stale until the next start.
     */
    private fun mirrorToCurrent(source: Path, fingerprint: String) {
        val stamp = currentDir.resolve(FINGERPRINT_FILE)
        val upToDate = isComplete(currentDir) &&
            runCatching { Files.readString(stamp).trim() == fingerprint }.getOrDefault(false)
        if (upToDate) return

        runCatching {
            if (Files.exists(currentDir)) deleteRecursively(currentDir)
            copyDir(source, currentDir)
            Files.writeString(stamp, fingerprint)
        }.onFailure { log.warn("Could not refresh runtime/current mirror", it) }
    }

    private fun copyDir(source: Path, dest: Path) {
        Files.walk(source).use { stream ->
            stream.forEach { src ->
                val target = dest.resolve(source.relativize(src).toString())
                if (Files.isDirectory(src)) {
                    Files.createDirectories(target)
                } else {
                    Files.createDirectories(target.parent)
                    Files.copy(src, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
                }
            }
        }
    }

    private fun deleteRecursively(dir: Path) {
        Files.walk(dir).use { stream ->
            stream.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }

    private fun isComplete(dir: Path): Boolean = REQUIRED.all { Files.isRegularFile(dir.resolve(it)) }

    /** SHA-256 of the bundled `main.js` from the plugin classpath. */
    private fun bundleFingerprint(): String {
        val url = SidecarRuntime::class.java.getResource("/sidecar/main.js")
            ?: error("Cannot find /sidecar/main.js in classpath — run 'npm run build' in the sidecar/ directory first")
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        url.openStream().use { input ->
            val buf = ByteArray(8192)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** Copy every classpath resource under `sidecar/` into [target], flattening the
     *  `sidecar/` prefix so `main.js` lands at the runtime root.
     *
     *  Locates the plugin artifact via a known resource URL rather than
     *  `protectionDomain.codeSource`, which is null in the Gradle `runIde` dev
     *  sandbox (IntelliJ's plugin classloader doesn't expose a code source). */
    private fun extractBundle(target: Path) {
        val markerUrl = SidecarRuntime::class.java.getResource("/sidecar/main.js")
            ?: error("Cannot find /sidecar/main.js in classpath — run 'npm run build' in the sidecar/ directory first")

        if (markerUrl.protocol == "jar") {
            // Production JAR: jar:file:/path/to/plugin.jar!/sidecar/main.js
            val jarUri = URI(markerUrl.toExternalForm().substringAfter("jar:").substringBefore("!"))
            val zipFile = ZipFile(Paths.get(jarUri).toFile())
            zipFile.use { zip: ZipFile ->
                zip.entries().asSequence()
                    .filter { e -> !e.isDirectory && e.name.startsWith("sidecar/") }
                    .forEach { e ->
                        zip.getInputStream(e).use { input -> copyInto(target, e.name.removePrefix("sidecar/"), input) }
                    }
            }
        } else if (markerUrl.protocol == "file") {
            // Dev sandbox: file:/path/to/build/resources/main/sidecar/main.js
            val sidecarDir = Paths.get(markerUrl.toURI()).parent
            Files.walk(sidecarDir).use { stream ->
                stream.filter { Files.isRegularFile(it) }.forEach { file ->
                    copyInto(target, sidecarDir.relativize(file).toString(), Files.newInputStream(file))
                }
            }
        } else {
            error("Unexpected classpath protocol '${markerUrl.protocol}' for sidecar bundle")
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
