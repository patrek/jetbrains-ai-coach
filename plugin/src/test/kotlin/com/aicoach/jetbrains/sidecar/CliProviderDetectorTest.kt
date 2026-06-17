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
    ): CliProviderDetector = CliProviderDetector(
        env = env,
        userHome = home,
        os = os,
        probe = { p, args ->
            probes?.add(p.toString() to args)
            responses[p.toString() to args] ?: ProbeOutcome.Unavailable
        },
        exists = { it.toString() in existing },
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
    fun `availability is memoized until invalidated`() {
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
        d.availability("claude") // cached — no new probes
        assertEquals(2, probes.size) // one --version + one auth status

        d.invalidate()
        d.availability("claude") // re-probes after invalidation
        assertEquals(4, probes.size)
    }
}
