package com.aicoach.jetbrains.settings

import org.junit.Assert.assertEquals
import org.junit.Test

/** Pure tests for the provider id/label mapping, exercised without the IntelliJ
 *  platform. (The per-window selection resolution `override.ifBlank(global)` is
 *  inlined at its call site in `WebviewBridge` per the plan.) */
class ProviderLabelsTest {

    @Test
    fun `global labels round-trip id to display and back`() {
        assertEquals("Claude Code", ProviderLabels.displayFor("claude"))
        assertEquals("claude", ProviderLabels.idFor("Claude Code"))
        assertEquals("", ProviderLabels.idFor("Disabled"))
    }

    @Test
    fun `an unknown id falls back to the disabled label`() {
        assertEquals("Disabled", ProviderLabels.displayFor("gemini"))
        assertEquals("", ProviderLabels.idFor("Nonexistent Provider"))
    }

    @Test
    fun `the global dropdown lists disabled first`() {
        assertEquals("Disabled", ProviderLabels.displayNames.first())
    }

    @Test
    fun `override labels map the inherit option to an empty id`() {
        assertEquals("", ProviderLabels.overrideIdFor("Use global default"))
        assertEquals("copilot", ProviderLabels.overrideIdFor("GitHub Copilot CLI"))
        assertEquals("Use global default", ProviderLabels.overrideDisplayFor(""))
    }
}
