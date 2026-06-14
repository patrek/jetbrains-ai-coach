package com.aicoach.jetbrains.sidecar

import com.aicoach.jetbrains.sidecar.NodeDetector.OsKind
import com.aicoach.jetbrains.sidecar.NodeDetector.ProbeOutcome
import com.aicoach.jetbrains.sidecar.NodeDetector.Result
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Cascade logic for [NodeDetector] with the version probe and filesystem checks
 * faked — no real Node, no real home directory. Verifies the priority order,
 * the >= 20 gate, the distinct failure states, and precise (non-globbed)
 * version-manager default resolution.
 */
class NodeDetectorTest {

    private val home: Path = Paths.get("/home/u")

    private fun detector(
        configured: String? = null,
        path: String = "/usr/bin",
        env: Map<String, String> = mapOf("PATH" to path),
        existing: Set<String> = emptySet(),
        responses: Map<String, ProbeOutcome> = emptyMap(),
        fileLines: Map<String, String> = emptyMap(),
    ): NodeDetector = NodeDetector(
        configuredPath = configured,
        env = env,
        userHome = home,
        os = OsKind.LINUX,
        probe = { p -> responses[p.toString()] ?: ProbeOutcome.Unavailable },
        exists = { p -> p.toString() in existing || p.toString() in fileLines },
        readLine = { p -> fileLines[p.toString()] },
    )

    @Test
    fun `found via PATH when node is recent enough`() {
        val result = detector(
            existing = setOf("/usr/bin/node"),
            responses = mapOf("/usr/bin/node" to ProbeOutcome.Responded("v20.11.0", 20)),
        ).detect()
        assertEquals(Result.Found("/usr/bin/node", "v20.11.0"), result)
    }

    @Test
    fun `configured override takes priority over PATH`() {
        val result = detector(
            configured = "/opt/node/bin/node",
            existing = setOf("/opt/node/bin/node", "/usr/bin/node"),
            responses = mapOf(
                "/opt/node/bin/node" to ProbeOutcome.Responded("v22.0.0", 22),
                "/usr/bin/node" to ProbeOutcome.Responded("v20.0.0", 20),
            ),
        ).detect()
        assertEquals(Result.Found("/opt/node/bin/node", "v22.0.0"), result)
    }

    @Test
    fun `too old node reports TooOld with the required major`() {
        val result = detector(
            configured = "/opt/old/node",
            existing = setOf("/opt/old/node"),
            responses = mapOf("/opt/old/node" to ProbeOutcome.Responded("v18.19.0", 18)),
        ).detect()
        assertEquals(Result.TooOld("/opt/old/node", "v18.19.0", 20), result)
    }

    @Test
    fun `a newer candidate still wins over an earlier too-old one`() {
        val result = detector(
            configured = "/opt/old/node",
            existing = setOf("/opt/old/node", "/usr/bin/node"),
            responses = mapOf(
                "/opt/old/node" to ProbeOutcome.Responded("v18.0.0", 18),
                "/usr/bin/node" to ProbeOutcome.Responded("v20.5.0", 20),
            ),
        ).detect()
        assertEquals(Result.Found("/usr/bin/node", "v20.5.0"), result)
    }

    @Test
    fun `malfunctioning node reports Broken`() {
        val result = detector(
            existing = setOf("/usr/bin/node"),
            responses = mapOf("/usr/bin/node" to ProbeOutcome.Malfunctioned("exit 1: segfault")),
        ).detect()
        assertEquals(Result.Broken("/usr/bin/node", "exit 1: segfault"), result)
    }

    @Test
    fun `nothing found reports Missing and lists the searched locations`() {
        val result = detector().detect()
        assertTrue(result is Result.Missing)
        val checked = (result as Result.Missing).checked
        // PATH, the version-manager defaults, and the well-known dirs are all
        // surfaced so the empty-state panel can show where it looked.
        assertTrue(checked.any { it.startsWith("PATH:") })
        assertTrue(checked.any { it.contains("volta") })
        assertTrue(checked.any { it.contains("/opt/homebrew/bin") })
    }

    @Test
    fun `resolves the nvm default alias precisely instead of globbing versions`() {
        // The alias points at v20 even though a higher v22 install also exists —
        // a glob would wrongly pick v22; the alias resolution must pick v20.
        val v20 = "/home/u/.nvm/versions/node/v20.11.0/bin/node"
        val v22 = "/home/u/.nvm/versions/node/v22.0.0/bin/node"
        val result = detector(
            existing = setOf(v20, v22),
            responses = mapOf(
                v20 to ProbeOutcome.Responded("v20.11.0", 20),
                v22 to ProbeOutcome.Responded("v22.0.0", 22),
            ),
            fileLines = mapOf("/home/u/.nvm/alias/default" to "v20.11.0"),
        ).detect()
        assertEquals(Result.Found(v20, "v20.11.0"), result)
    }

    @Test
    fun `follows an nvm alias chain to a concrete version`() {
        val v20 = "/home/u/.nvm/versions/node/v20.11.0/bin/node"
        val result = detector(
            existing = setOf(v20),
            responses = mapOf(v20 to ProbeOutcome.Responded("v20.11.0", 20)),
            fileLines = mapOf(
                "/home/u/.nvm/alias/default" to "lts/iron",
                "/home/u/.nvm/alias/lts/iron" to "v20.11.0",
            ),
        ).detect()
        assertEquals(Result.Found(v20, "v20.11.0"), result)
    }

    @Test
    fun `unlaunchable candidates are skipped, not reported as broken`() {
        // Present on disk but ENOENT on spawn (e.g. a dangling symlink), then a
        // good one later: the good one wins and the failure is Missing-not-Broken
        // when nothing usable exists.
        val result = detector(
            existing = setOf("/usr/bin/node"),
            responses = mapOf("/usr/bin/node" to ProbeOutcome.Unavailable),
        ).detect()
        assertTrue("expected Missing, got $result", result is Result.Missing)
    }
}
