package com.aicoach.jetbrains.trust

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests for [parsePendingRules] — the pure wire-parsing of the sidecar's
 *  pending-rules responses, exercised without the IntelliJ platform. */
class TrustGateParsingTest {

    private fun parse(json: String) = parsePendingRules(JsonParser.parseString(json))

    @Test
    fun `parses pending entries with all fields`() {
        val rules = parse(
            """{"pending":[
                {"filePath":"/p/.ai-engineer-coach/rules/a.md","layer":"project","kind":"rule","hash":"abc"},
                {"filePath":"/h/.ai-engineer-coach/metrics/b.metric.md","layer":"personal","kind":"metric","hash":"def"}
            ]}""",
        )
        assertEquals(2, rules.size)
        assertEquals("/p/.ai-engineer-coach/rules/a.md", rules[0].filePath)
        assertEquals("project", rules[0].layer)
        assertEquals("rule", rules[0].kind)
        assertEquals("abc", rules[0].hash)
        assertEquals("metric", rules[1].kind)
        assertEquals("personal", rules[1].layer)
    }

    @Test
    fun `missing pending array yields empty list`() {
        assertTrue(parse("""{"ok":true}""").isEmpty())
        assertTrue(parse("""{"pending":{}}""").isEmpty()) // not an array
    }

    @Test
    fun `non-object data yields empty list`() {
        assertTrue(parsePendingRules(null).isEmpty())
        assertTrue(parse("""[]""").isEmpty())
        assertTrue(parse("""42""").isEmpty())
    }

    @Test
    fun `entries without a filePath are skipped, other fields default`() {
        val rules = parse(
            """{"pending":[
                {"layer":"project","kind":"rule","hash":"x"},
                {"filePath":"/p/r.md"}
            ]}""",
        )
        // First entry skipped (no filePath); second kept with defaults.
        assertEquals(1, rules.size)
        assertEquals("/p/r.md", rules[0].filePath)
        assertEquals("personal", rules[0].layer)
        assertEquals("rule", rules[0].kind)
        assertEquals("", rules[0].hash)
    }
}
