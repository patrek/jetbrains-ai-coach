package com.aicoach.jetbrains.sidecar

import com.aicoach.jetbrains.sidecar.CliProviderDetector.Availability
import com.aicoach.jetbrains.sidecar.CliProviderDetector.ProbeOutcome
import com.aicoach.jetbrains.sidecar.CliProviderDetector.Status
import com.aicoach.jetbrains.sidecar.NodeDetector.OsKind
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Cascade + auth-probe logic for [CliProviderDetector] with the binary probe and
 * filesystem checks faked — no real CLI, no real PATH. Verifies the per-provider
 * install detection, the distinct auth signals (Claude `auth status` exit code vs
 * Copilot env-token presence), the well-known cascade, and the memoization.
 */
class CliProviderDetectorTest {

    private val home: Path = Paths.get("/home/u")

    private fun detector(
        env: Map<String, String> = mapOf("PATH" to "/usr/bin"),
        existing: Set<String> = emptySet(),
        responses: Map<Pair<String, List<String>>, ProbeOutcome> = emptyMap(),
        probes: MutableList<Pair<String, List<String>>>? = null,
        os: OsKind = OsKind.LINUX,
        authFiles: Map<String, String> = emptyMap(),
    ): CliProviderDetector = CliProviderDetector(
        env = env,
        userHome = home,
        os = os,
        probe = { p, args ->
            probes?.add(p.toString() to args)
            responses[p.toString() to args] ?: ProbeOutcome.Unavailable
        },
        exists = { it.toString() in existing || it.toString() in authFiles },
        readFile = { authFiles[it.toString()] },
    )

    private fun version(stdout: String = "1.0.0") = ProbeOutcome.Exited(0, stdout)

    @Test
    fun `claude installed and authenticated is ACTIVE`() {
        val d = detector(
            existing = setOf("/usr/bin/claude"),
            responses = mapOf(
                ("/usr/bin/claude" to listOf("--version")) to version(),
                ("/usr/bin/claude" to listOf("auth", "status")) to ProbeOutcome.Exited(0, "Logged in"),
            ),
        )
        assertEquals(Availability("/usr/bin/claude", Status.ACTIVE), d.availability("claude"))
    }

    @Test
    fun `claude installed but auth status non-zero is UNAUTHENTICATED`() {
        val d = detector(
            existing = setOf("/usr/bin/claude"),
            responses = mapOf(
                ("/usr/bin/claude" to listOf("--version")) to version(),
                ("/usr/bin/claude" to listOf("auth", "status")) to ProbeOutcome.Exited(1, "Not logged in"),
            ),
        )
        assertEquals(Availability("/usr/bin/claude", Status.UNAUTHENTICATED), d.availability("claude"))
    }

    @Test
    fun `claude absent from the cascade is NOT_INSTALLED`() {
        assertEquals(Availability(null, Status.NOT_INSTALLED), detector().availability("claude"))
    }

    @Test
    fun `a present binary whose --version fails is NOT_INSTALLED`() {
        val d = detector(
            existing = setOf("/usr/bin/claude"),
            responses = mapOf(("/usr/bin/claude" to listOf("--version")) to ProbeOutcome.Exited(127, "")),
        )
        assertEquals(Availability(null, Status.NOT_INSTALLED), d.availability("claude"))
    }

    @Test
    fun `copilot installed with a GitHub token env var is ACTIVE`() {
        val d = detector(
            env = mapOf("PATH" to "/usr/bin", "GH_TOKEN" to "ghp_x"),
            existing = setOf("/usr/bin/copilot"),
            responses = mapOf(("/usr/bin/copilot" to listOf("--version")) to version()),
        )
        assertEquals(Availability("/usr/bin/copilot", Status.ACTIVE), d.availability("copilot"))
    }

    @Test
    fun `each accepted GitHub token env var alone authenticates copilot`() {
        for (tokenVar in CliProviderDetector.COPILOT_TOKEN_ENV) {
            val d = detector(
                env = mapOf("PATH" to "/usr/bin", tokenVar to "tok"),
                existing = setOf("/usr/bin/copilot"),
                responses = mapOf(("/usr/bin/copilot" to listOf("--version")) to version()),
            )
            assertEquals(
                "expected $tokenVar to authenticate copilot",
                Status.ACTIVE,
                d.availability("copilot").status,
            )
        }
    }

    @Test
    fun `copilot installed without any token env var is UNAUTHENTICATED`() {
        val d = detector(
            env = mapOf("PATH" to "/usr/bin"),
            existing = setOf("/usr/bin/copilot"),
            responses = mapOf(("/usr/bin/copilot" to listOf("--version")) to version()),
        )
        // Copilot has no auth-status subcommand: it is never probed for auth.
        assertEquals(Availability("/usr/bin/copilot", Status.UNAUTHENTICATED), d.availability("copilot"))
    }

    @Test
    fun `codex installed with OPENAI_API_KEY env var is ACTIVE`() {
        val d = detector(
            env = mapOf("PATH" to "/usr/bin", "OPENAI_API_KEY" to "sk-test123"),
            existing = setOf("/usr/bin/codex"),
            responses = mapOf(("/usr/bin/codex" to listOf("--version")) to version()),
        )
        assertEquals(Availability("/usr/bin/codex", Status.ACTIVE), d.availability("codex"))
    }

    @Test
    fun `codex installed with valid auth json access_token is ACTIVE`() {
        val authJson = """{"tokens":{"access_token":"tok_abc123","refresh_token":"ref_xyz"}}"""
        val d = detector(
            existing = setOf("/usr/bin/codex"),
            responses = mapOf(("/usr/bin/codex" to listOf("--version")) to version()),
            authFiles = mapOf("/home/u/.codex/auth.json" to authJson),
        )
        assertEquals(Status.ACTIVE, d.availability("codex").status)
    }

    @Test
    fun `codex installed with valid auth json OPENAI_API_KEY field is ACTIVE`() {
        val authJson = """{"OPENAI_API_KEY":"sk-test456"}"""
        val d = detector(
            existing = setOf("/usr/bin/codex"),
            responses = mapOf(("/usr/bin/codex" to listOf("--version")) to version()),
            authFiles = mapOf("/home/u/.codex/auth.json" to authJson),
        )
        assertEquals(Status.ACTIVE, d.availability("codex").status)
    }

    @Test
    fun `codex installed without API key or auth json is UNAUTHENTICATED`() {
        val d = detector(
            env = mapOf("PATH" to "/usr/bin"),
            existing = setOf("/usr/bin/codex"),
            responses = mapOf(("/usr/bin/codex" to listOf("--version")) to version()),
        )
        assertEquals(Availability("/usr/bin/codex", Status.UNAUTHENTICATED), d.availability("codex"))
    }

    @Test
    fun `codex with null access_token in auth json is UNAUTHENTICATED`() {
        val authJson = """{"tokens":{"access_token":null}}"""
        val d = detector(
            existing = setOf("/usr/bin/codex"),
            responses = mapOf(("/usr/bin/codex" to listOf("--version")) to version()),
            authFiles = mapOf("/home/u/.codex/auth.json" to authJson),
        )
        assertEquals(Status.UNAUTHENTICATED, d.availability("codex").status)
    }

    @Test
    fun `an unknown provider id is NOT_INSTALLED`() {
        assertEquals(Availability(null, Status.NOT_INSTALLED), detector().availability("gemini"))
    }

    @Test
    fun `the cascade reaches well-known locations beyond PATH`() {
        val d = detector(
            env = mapOf("PATH" to "/empty"),
            existing = setOf("/opt/homebrew/bin/claude"),
            responses = mapOf(
                ("/opt/homebrew/bin/claude" to listOf("--version")) to version(),
                ("/opt/homebrew/bin/claude" to listOf("auth", "status")) to ProbeOutcome.Exited(0, ""),
            ),
        )
        assertEquals(Availability("/opt/homebrew/bin/claude", Status.ACTIVE), d.availability("claude"))
    }

    @Test
    fun `an ACTIVE result is memoized until invalidated`() {
        val probes = mutableListOf<Pair<String, List<String>>>()
        val d = detector(
            existing = setOf("/usr/bin/claude"),
            responses = mapOf(
                ("/usr/bin/claude" to listOf("--version")) to version(),
                ("/usr/bin/claude" to listOf("auth", "status")) to ProbeOutcome.Exited(0, ""),
            ),
            probes = probes,
        )

        d.availability("claude")
        d.availability("claude") // ACTIVE is cached — no new probes
        assertEquals(2, probes.size) // one --version + one auth status

        d.invalidate()
        d.availability("claude") // re-probes after invalidation
        assertEquals(4, probes.size)
    }

    @Test
    fun `a degraded result is not cached, so a transient failure self-heals`() {
        val probes = mutableListOf<Pair<String, List<String>>>()
        // Mutable auth response: starts failing (transient), then recovers.
        var authExit = 1
        val d = CliProviderDetector(
            env = mapOf("PATH" to "/usr/bin"),
            userHome = home,
            os = OsKind.LINUX,
            probe = { p, args ->
                probes.add(p.toString() to args)
                when {
                    args == listOf("--version") -> version()
                    args == listOf("auth", "status") -> ProbeOutcome.Exited(authExit, "")
                    else -> ProbeOutcome.Unavailable
                }
            },
            exists = { it.toString() == "/usr/bin/claude" },
        )

        // First poll: auth probe fails -> UNAUTHENTICATED, NOT cached.
        assertEquals(Status.UNAUTHENTICATED, d.availability("claude").status)
        // Auth recovers; the next poll re-probes (no stale cached negative) -> ACTIVE.
        authExit = 0
        assertEquals(Status.ACTIVE, d.availability("claude").status)
        // Now ACTIVE is cached: a third call does not re-probe.
        val probeCountAfterActive = probes.size
        d.availability("claude")
        assertEquals(probeCountAfterActive, probes.size)
    }
}
