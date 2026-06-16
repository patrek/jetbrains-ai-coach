package com.aicoach.jetbrains.settings

import org.junit.Assert.assertEquals
import org.junit.Test

/** Pure tests for [CoachSettings]'s excluded-directory normalization, exercised
 *  without the IntelliJ platform (the instance is constructed directly, never
 *  via the application service). */
class CoachSettingsTest {

    @Test
    fun `excludedDirs trims entries and drops blanks on write`() {
        val settings = CoachSettings()
        settings.excludedDirs = listOf("  /home/u/.claude  ", "", "   ", "/home/u/.codex")
        assertEquals(listOf("/home/u/.claude", "/home/u/.codex"), settings.excludedDirs)
    }

    @Test
    fun `excludedDirs defaults to empty`() {
        assertEquals(emptyList<String>(), CoachSettings().excludedDirs)
    }

    @Test
    fun `excludedDirs round-trips through the serialized state`() {
        val source = CoachSettings()
        source.excludedDirs = listOf("/a", "/b")

        val restored = CoachSettings()
        restored.loadState(source.state)
        assertEquals(listOf("/a", "/b"), restored.excludedDirs)
    }

    @Test
    fun `nodePath blanks normalize to null`() {
        val settings = CoachSettings()
        settings.nodePath = "   "
        assertEquals(null, settings.nodePath)
    }

    @Test
    fun `nodePath trims a real value`() {
        val settings = CoachSettings()
        settings.nodePath = "  /usr/local/bin/node  "
        assertEquals("/usr/local/bin/node", settings.nodePath)
    }
}
