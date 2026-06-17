package com.aicoach.jetbrains.sidecar

import com.aicoach.jetbrains.sidecar.NodeDetector.OsKind
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.ConcurrentHashMap

/**
 * Detects which CLI inference providers are installed and authenticated, the way
 * [NodeDetector] detects Node: a PATH-plus-well-known cascade, with the binary
 * probe and filesystem checks injectable so the logic is unit-tested without
 * spawning a real CLI.
 *
 * Detection is a property of the **machine/PATH**, identical across IDE windows,
 * so this is an app-level service whose results are **memoized** (the per-window
 * differences — which provider a project selected — are resolved elsewhere, in
 * [com.aicoach.jetbrains.jcef.WebviewBridge]). The cache is invalidated on a
 * settings change and on "Restart sidecar"; the first (uncached) probe spawns a
 * child, so callers must invoke [availability] off the EDT/CEF thread.
 *
 * No probe costs an LLM call: installation is a `--version` run; Claude auth is a
 * `claude auth status` exit code; Copilot auth is best-effort env-token presence
 * (it has no `auth status` subcommand — real failures surface post-run as
 * `cli-error`).
 */
@Service(Service.Level.APP)
class CliProviderDetector(
    private val env: Map<String, String> = System.getenv(),
    private val userHome: Path = Paths.get(System.getProperty("user.home")),
    private val os: OsKind = NodeDetector.currentOs(),
    private val probe: (Path, List<String>) -> ProbeOutcome = ::runCommand,
    private val exists: (Path) -> Boolean = { Files.exists(it) },
) {

    /** Outcome of launching a candidate binary with some arguments. */
    sealed interface ProbeOutcome {
        /** Launched and exited with [code]; [stdout] captured (trimmed). */
        data class Exited(val code: Int, val stdout: String) : ProbeOutcome

        /** Couldn't be launched (ENOENT / timeout / not executable). */
        data object Unavailable : ProbeOutcome
    }

    /** The resolved availability of one provider on this machine. */
    enum class Status {
        /** Installed and authenticated — `capabilities.llm` may be true. */
        ACTIVE,

        /** No usable binary found on the cascade. */
        NOT_INSTALLED,

        /** Installed but not authenticated (Claude `auth status` non-zero, or no
         *  Copilot env token). */
        UNAUTHENTICATED,
    }

    /** [binaryPath] is the resolved executable when [status] is [Status.ACTIVE] or
     *  [Status.UNAUTHENTICATED]; `null` when [Status.NOT_INSTALLED]. */
    data class Availability(val binaryPath: String?, val status: Status)

    private val cache = ConcurrentHashMap<String, Availability>()

    /** The memoized availability of [providerId] (`claude` / `copilot`). The first
     *  call per id spawns probes — call off the EDT/CEF thread. An unknown id is
     *  reported as [Status.NOT_INSTALLED]. Two concurrent first calls may probe
     *  twice; that is harmless (the probe is read-only and idempotent) and avoids
     *  holding a lock across a child-process spawn. */
    fun availability(providerId: String): Availability =
        cache.getOrPut(providerId) { detect(providerId) }

    /** Drop all cached results so the next [availability] re-probes. Called when
     *  settings change or the sidecar is restarted. */
    fun invalidate() {
        cache.clear()
    }

    private fun detect(providerId: String): Availability {
        if (providerId != "claude" && providerId != "copilot") {
            return Availability(null, Status.NOT_INSTALLED)
        }
        val binary = findBinary(providerId) ?: return Availability(null, Status.NOT_INSTALLED)
        val authed = when (providerId) {
            "claude" -> isClaudeAuthenticated(binary)
            else -> hasCopilotToken()
        }
        return Availability(binary.toString(), if (authed) Status.ACTIVE else Status.UNAUTHENTICATED)
    }

    /** First cascade candidate that exists and answers `--version` with exit 0. */
    private fun findBinary(name: String): Path? {
        for (candidate in candidates(name)) {
            if (!exists(candidate)) continue
            val outcome = probe(candidate, listOf("--version"))
            if (outcome is ProbeOutcome.Exited && outcome.code == 0) return candidate
        }
        return null
    }

    /** `claude auth status` exits 0 when authenticated, non-zero otherwise. */
    private fun isClaudeAuthenticated(binary: Path): Boolean {
        val outcome = probe(binary, listOf("auth", "status"))
        return outcome is ProbeOutcome.Exited && outcome.code == 0
    }

    /** Copilot has no `auth status`; treat any GitHub token env var as authed. */
    private fun hasCopilotToken(): Boolean =
        COPILOT_TOKEN_ENV.any { !env[it].isNullOrBlank() }

    /** Ordered, de-duped absolute candidate paths for [name]. */
    private fun candidates(name: String): List<Path> {
        val out = LinkedHashSet<Path>()
        for (exe in executableNames(name)) {
            (env["PATH"] ?: env["Path"])?.split(File.pathSeparatorChar)
                ?.filter { it.isNotBlank() }
                ?.forEach { dir -> out.add(Paths.get(dir, exe).normalize()) }
            for (dir in wellKnownDirs()) out.add(dir.resolve(exe).normalize())
        }
        return out.toList()
    }

    /** npm-installed CLIs land as `.cmd` shims on Windows; the native installers
     *  produce a bare name elsewhere. */
    private fun executableNames(name: String): List<String> =
        if (os == OsKind.WINDOWS) listOf("$name.cmd", "$name.exe", name) else listOf(name)

    private fun wellKnownDirs(): List<Path> = when (os) {
        OsKind.WINDOWS -> buildList {
            env["LOCALAPPDATA"]?.let { add(Paths.get(it, "Programs")) }
            env["APPDATA"]?.let { add(Paths.get(it, "npm")) }
        }
        else -> listOf(
            userHome.resolve(".local/bin"), // Claude native installer / pipx-style
            Paths.get("/opt/homebrew/bin"), // Apple Silicon Homebrew
            Paths.get("/usr/local/bin"), // Intel Homebrew / npm global / manual
        )
    }

    companion object {
        /** GitHub token env vars Copilot honors, checked in order of specificity. */
        val COPILOT_TOKEN_ENV = listOf("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN")

        private const val PROBE_TIMEOUT_MS = 5_000
        private val log = logger<CliProviderDetector>()

        fun getInstance(): CliProviderDetector =
            ApplicationManager.getApplication().getService(CliProviderDetector::class.java)

        /** The live probe: run `binary args` with a hang guard, capture exit + stdout. */
        fun runCommand(binary: Path, args: List<String>): ProbeOutcome {
            val commandLine = GeneralCommandLine(buildList { add(binary.toString()); addAll(args) })
            return try {
                val output = CapturingProcessHandler(commandLine).runProcess(PROBE_TIMEOUT_MS)
                if (output.isTimeout) ProbeOutcome.Unavailable
                else ProbeOutcome.Exited(output.exitCode, output.stdout.trim())
            } catch (e: Exception) {
                // ProcessNotCreatedException (ENOENT) and friends: not a candidate.
                log.debug("provider probe failed to launch: $binary $args", e)
                ProbeOutcome.Unavailable
            }
        }
    }
}
