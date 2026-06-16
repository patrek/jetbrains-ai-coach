package com.aicoach.jetbrains.disclosure

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure tests for the disclosed surface — the directory list and the message
 *  body — without the IntelliJ platform or a live balloon. */
class DataAccessDisclosureTest {

    @Test
    fun `discloses every harness directory the sidecar reads`() {
        val paths = DataAccessDisclosure.directories().map { it.path }
        assertTrue(paths.contains("~/.claude"))
        assertTrue(paths.contains("~/.codex"))
        assertTrue(paths.contains("~/.local/share/opencode"))
        assertTrue(paths.contains("~/.copilot"))
    }

    @Test
    fun `message states read-only, local, and zero telemetry`() {
        val message = DataAccessDisclosure.message()
        assertTrue(message.contains("read-only"))
        assertTrue(message.contains("on your machine"))
        assertTrue(message.contains("zero telemetry"))
    }

    @Test
    fun `message lists each disclosed directory`() {
        val message = DataAccessDisclosure.message()
        DataAccessDisclosure.directories().forEach { dir ->
            assertTrue("message should mention ${dir.path}", message.contains(dir.path))
        }
    }

    @Test
    fun `message points at the exclusion setting`() {
        assertTrue(DataAccessDisclosure.message().contains("Settings → Tools → AI Usage Coach"))
    }

    @Test
    fun `message renders a controlled directory list as list items`() {
        val dirs = listOf(DataAccessDisclosure.DataDir("Demo", "~/.demo"))
        val message = DataAccessDisclosure.message(dirs)
        assertTrue(message.contains("<li><code>~/.demo</code> — Demo</li>"))
        assertFalse(message.contains("~/.claude"))
    }

    @Test
    fun `message with no directories still produces a well-formed list`() {
        val message = DataAccessDisclosure.message(emptyList())
        assertTrue(message.contains("<ul></ul>"))
        assertFalse(message.contains("<li>"))
    }
}
