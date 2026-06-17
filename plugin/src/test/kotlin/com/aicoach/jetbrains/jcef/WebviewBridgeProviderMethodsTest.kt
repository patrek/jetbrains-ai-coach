package com.aicoach.jetbrains.jcef

import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * Guards the cross-layer contract that broke once: the host only stamps an
 * inference provider onto methods in [WebviewBridge.PROVIDER_METHODS]. A
 * provider-backed method missing from that set is forwarded with no provider, so
 * the sidecar's `runWithProvider` degrades it to `llm-unavailable` — the feature
 * silently never works, and no sidecar/Kotlin unit test catches it because each
 * side is exercised in isolation.
 *
 * The webview's `PROVIDER_METHODS` (in patch `0006`) and the sidecar's
 * provider-backed handlers are the other two copies of this list. This test pins
 * the host set against the webview patch — the canonical shared declaration — so
 * adding a provider-backed method on one side without the other fails the build.
 */
class WebviewBridgeProviderMethodsTest {

    /** The six methods routed through a CLI provider: the original two plus the
     *  four learning-page methods wired via `createLearningHandlers`. */
    private val expected = setOf(
        "generateRule",
        "explainOccurrence",
        "generateLearningQuiz",
        "generateLearningResources",
        "generateCodeComparison",
        "generateDidYouKnow",
    )

    @Test
    fun `host stamps every provider-backed method`() {
        assertEquals(expected, WebviewBridge.PROVIDER_METHODS)
    }

    @Test
    fun `host PROVIDER_METHODS matches the webview patch declaration`() {
        val patch = repoFile("tools/patches/0006-webview-llm-capability-gate.patch")
        val webviewMethods = parseProviderMethods(patch.readText())

        assertTrue(
            "Could not find `PROVIDER_METHODS = new Set([` in ${patch.path}; the patch " +
                "format changed and this guard needs updating.",
            webviewMethods.isNotEmpty(),
        )
        assertEquals(
            "Host WebviewBridge.PROVIDER_METHODS and the webview patch's PROVIDER_METHODS " +
                "have drifted. Both (and the sidecar handlers) must list the same methods.",
            webviewMethods,
            WebviewBridge.PROVIDER_METHODS,
        )
    }

    /** Extract the quoted method names from the patch's
     *  `const PROVIDER_METHODS = new Set([ ... ])` block. */
    private fun parseProviderMethods(patchText: String): Set<String> {
        val anchor = patchText.indexOf("PROVIDER_METHODS = new Set([")
        if (anchor == -1) return emptySet()
        val close = patchText.indexOf("])", anchor)
        if (close == -1) return emptySet()
        val block = patchText.substring(anchor, close)
        return Regex("'([^']+)'").findAll(block).map { it.groupValues[1] }.toSet()
    }

    /** Resolve a repo-root-relative path by walking up from the test working
     *  directory until the file is found (the JVM cwd is the Gradle module, not
     *  the repo root). */
    private fun repoFile(relative: String): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate
            dir = dir.parentFile
        }
        throw AssertionError("Could not locate '$relative' from ${System.getProperty("user.dir")}")
    }
}
