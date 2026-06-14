package com.aicoach.jetbrains.sidecar

import com.aicoach.jetbrains.settings.CoachSettings
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.diagnostic.logger
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Locates a usable Node.js (>= 20) for the sidecar.
 *
 * The cascade is the whole point: a bare `node` lookup fails for the most
 * common first-run case — a macOS GUI launch where the IDE inherits a minimal
 * PATH that omits the user's version-manager shims. So we try, in order:
 *
 *   1. the configured override ([CoachSettings.nodePath]);
 *   2. every directory on the inherited PATH;
 *   3. version-manager **defaults**, resolved precisely (never globbed — a glob
 *      of `~/.nvm/versions/node` entries picks the lexicographically-highest install,
 *      not the user's actual default);
 *   4. well-known install locations.
 *
 * A version-manager default that can't be resolved cleanly is skipped, not
 * guessed — the UI's manual picker is the honest fallback.
 *
 * The probe and filesystem checks are injectable so the cascade is unit-tested
 * without spawning a real Node or touching a real home directory.
 */
class NodeDetector(
    private val configuredPath: String?,
    private val env: Map<String, String>,
    private val userHome: Path,
    private val os: OsKind,
    private val probe: (Path) -> ProbeOutcome = { runNodeVersion(it) },
    private val exists: (Path) -> Boolean = { Files.exists(it) },
    private val readLine: (Path) -> String? = { readFirstLine(it) },
) {

    enum class OsKind { MAC, LINUX, WINDOWS }

    /** Outcome of probing a single candidate with `node --version`. */
    sealed interface ProbeOutcome {
        /** Ran and printed a parseable version. */
        data class Responded(val rawVersion: String, val major: Int) : ProbeOutcome

        /** Launched but misbehaved: non-zero exit, timeout, or garbage output. */
        data class Malfunctioned(val detail: String) : ProbeOutcome

        /** Couldn't be launched (no such file) — not a candidate, keep looking. */
        data object Unavailable : ProbeOutcome
    }

    /** The terminal result the UI renders a panel for. */
    sealed interface Result {
        data class Found(val path: String, val version: String) : Result
        data class TooOld(val path: String, val version: String, val required: Int) : Result
        data class Broken(val path: String, val detail: String) : Result
        data class Missing(val checked: List<String>) : Result
    }

    private data class Candidate(val path: Path, val display: String)

    /** Run the cascade and return the first usable Node, or the most actionable
     *  failure. Blocking (spawns `node --version`) — call off the EDT. */
    fun detect(): Result {
        val checked = mutableListOf<String>()
        // The failure of the highest-priority candidate that produced any signal.
        // A configured-but-too-old path should say "too old", not fall through to
        // a generic "missing" just because a later candidate was also unusable.
        var firstFailure: Result? = null

        for (candidate in candidates()) {
            // Record every location we look in so the "missing" panel can list
            // them, even the ones that turned out not to exist.
            checked += candidate.display
            if (!exists(candidate.path)) continue
            when (val outcome = probe(candidate.path)) {
                is ProbeOutcome.Responded -> {
                    if (outcome.major >= MIN_MAJOR) {
                        return Result.Found(candidate.path.toString(), outcome.rawVersion)
                    }
                    if (firstFailure == null) {
                        firstFailure = Result.TooOld(candidate.path.toString(), outcome.rawVersion, MIN_MAJOR)
                    }
                }
                is ProbeOutcome.Malfunctioned -> {
                    if (firstFailure == null) firstFailure = Result.Broken(candidate.path.toString(), outcome.detail)
                }
                ProbeOutcome.Unavailable -> Unit // present but unlaunchable; keep looking
            }
        }
        return firstFailure ?: Result.Missing(checked.distinct())
    }

    /** The ordered candidate list. Each entry is an absolute path to a Node
     *  executable; non-existent entries are filtered by [detect]. */
    private fun candidates(): List<Candidate> {
        val exe = nodeExecutableName()
        val out = LinkedHashMap<Path, Candidate>() // de-dupe, preserve order

        fun add(path: Path, display: String) {
            out.putIfAbsent(path.normalize(), Candidate(path.normalize(), display))
        }

        configuredPath?.takeIf { it.isNotBlank() }?.let { add(Paths.get(it), "Configured override: $it") }

        (env["PATH"] ?: env["Path"])?.split(File.pathSeparatorChar)
            ?.filter { it.isNotBlank() }
            ?.forEach { dir -> add(Paths.get(dir, exe), "PATH: $dir") }

        for ((path, display) in versionManagerDefaults(exe)) add(path, display)
        for ((path, display) in wellKnownLocations(exe)) add(path, display)

        return out.values.toList()
    }

    /** Precise (never globbed) version-manager default resolution. */
    private fun versionManagerDefaults(exe: String): List<Pair<Path, String>> {
        val result = mutableListOf<Pair<Path, String>>()

        // nvm: resolve $NVM_DIR/alias/default to a concrete version's bin/.
        val nvmDir = env["NVM_DIR"]?.let { Paths.get(it) } ?: userHome.resolve(".nvm")
        resolveNvmDefault(nvmDir)?.let { version ->
            result += nvmDir.resolve("versions/node/$version/bin/$exe") to "nvm default ($version)"
        }

        // fnm: the resolved `default` alias symlink's bin/.
        val fnmDirs = buildList {
            env["FNM_DIR"]?.let { add(Paths.get(it)) }
            add(userHome.resolve(".local/share/fnm")) // Linux default
            add(userHome.resolve(".fnm"))             // macOS default
        }
        for (dir in fnmDirs) {
            result += dir.resolve("aliases/default/bin/$exe") to "fnm default"
        }

        // volta: a single shim dir, no version resolution needed.
        val voltaHome = env["VOLTA_HOME"]?.let { Paths.get(it) } ?: userHome.resolve(".volta")
        result += voltaHome.resolve("bin/$exe") to "volta"

        return result
    }

    /**
     * Read `$NVM_DIR/alias/default` and resolve it to a concrete `vX.Y.Z`
     * directory name. The alias may point at another alias (e.g. an `lts` alias ->
     * `lts/iron` -> `v20.x`); follow at most a few hops, then give up rather
     * than guess.
     */
    private fun resolveNvmDefault(nvmDir: Path): String? {
        var aliasFile = nvmDir.resolve("alias/default")
        repeat(MAX_ALIAS_HOPS) {
            if (!exists(aliasFile)) return null
            val target = readLine(aliasFile)?.trim().orEmpty()
            if (target.isEmpty()) return null
            if (CONCRETE_VERSION.matches(target)) return target
            // Not concrete: treat as another alias name and follow it.
            aliasFile = nvmDir.resolve("alias/$target")
        }
        return null
    }

    private fun wellKnownLocations(exe: String): List<Pair<Path, String>> = when (os) {
        OsKind.WINDOWS -> {
            val programFiles = env["ProgramFiles"] ?: "C:\\Program Files"
            listOf(Paths.get(programFiles, "nodejs", exe) to "Program Files\\nodejs")
        }
        else -> listOf(
            Paths.get("/opt/homebrew/bin", exe) to "/opt/homebrew/bin", // Apple Silicon Homebrew
            Paths.get("/usr/local/bin", exe) to "/usr/local/bin",       // Intel Homebrew / manual installs
        )
    }

    private fun nodeExecutableName(): String = if (os == OsKind.WINDOWS) "node.exe" else "node"

    companion object {
        const val MIN_MAJOR = 20
        private const val MAX_ALIAS_HOPS = 4
        private val CONCRETE_VERSION = Regex("""v\d+\.\d+\.\d+""")
        private val VERSION_LINE = Regex("""v?(\d+)\.\d+\.\d+""")
        private val log = logger<NodeDetector>()

        /** Build a detector wired to the live system (settings, env, home, OS). */
        fun forCurrentSystem(): NodeDetector = NodeDetector(
            configuredPath = CoachSettings.getInstance().nodePath,
            env = System.getenv(),
            userHome = Paths.get(System.getProperty("user.home")),
            os = currentOs(),
        )

        fun currentOs(): OsKind {
            val name = System.getProperty("os.name").lowercase()
            return when {
                name.contains("win") -> OsKind.WINDOWS
                name.contains("mac") || name.contains("darwin") -> OsKind.MAC
                else -> OsKind.LINUX
            }
        }

        /** The real `node --version` probe: a 5s hang guard, version parsing. */
        fun runNodeVersion(path: Path): ProbeOutcome {
            val commandLine = GeneralCommandLine(path.toString(), "--version")
            return try {
                val output = CapturingProcessHandler(commandLine).runProcess(PROBE_TIMEOUT_MS)
                when {
                    output.isTimeout -> ProbeOutcome.Malfunctioned("timed out after ${PROBE_TIMEOUT_MS}ms")
                    output.exitCode != 0 ->
                        ProbeOutcome.Malfunctioned("exit ${output.exitCode}: ${output.stderr.trim().take(200)}")
                    else -> parseVersion(output.stdout.trim())
                }
            } catch (e: Exception) {
                // ProcessNotCreatedException (ENOENT) and friends: the binary
                // vanished between the exists() check and the spawn, or isn't
                // really executable. Treat as "not a candidate".
                log.debug("node probe failed to launch: $path", e)
                ProbeOutcome.Unavailable
            }
        }

        private fun parseVersion(stdout: String): ProbeOutcome {
            val match = VERSION_LINE.find(stdout)
                ?: return ProbeOutcome.Malfunctioned("unrecognized version output: ${stdout.take(80)}")
            val major = match.groupValues[1].toIntOrNull()
                ?: return ProbeOutcome.Malfunctioned("unrecognized version output: ${stdout.take(80)}")
            return ProbeOutcome.Responded(match.value, major)
        }

        private const val PROBE_TIMEOUT_MS = 5_000

        private fun readFirstLine(path: Path): String? =
            runCatching { Files.newBufferedReader(path).use { it.readLine() } }.getOrNull()
    }
}
