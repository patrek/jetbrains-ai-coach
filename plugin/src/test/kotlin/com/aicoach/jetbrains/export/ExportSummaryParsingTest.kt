package com.aicoach.jetbrains.export

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit tests for [parseExportFiles] — the pure wire-parsing of the sidecar's
 *  `exportSummaryContent` response, exercised without the IntelliJ platform. */
class ExportSummaryParsingTest {

    private fun parse(json: String) = parseExportFiles(JsonParser.parseString(json))

    @Test
    fun `parses filename and content for each file`() {
        val files = parse(
            """{"files":[
                {"filename":"ai-engineer-coach-summary-2026-06-15.md","content":"# Summary"},
                {"filename":"ai-engineer-coach-summary-2026-06-15.json","content":"{}"}
            ]}""",
        )
        assertEquals(2, files.size)
        assertEquals("ai-engineer-coach-summary-2026-06-15.md", files[0].filename)
        assertEquals("# Summary", files[0].content)
        assertEquals("{}", files[1].content)
    }

    @Test
    fun `missing files array yields empty list`() {
        assertTrue(parse("""{"ok":true}""").isEmpty())
        assertTrue(parse("""{"files":{}}""").isEmpty())
    }

    @Test
    fun `non-object data yields empty list`() {
        assertTrue(parseExportFiles(null).isEmpty())
        assertTrue(parse("""[]""").isEmpty())
    }

    @Test
    fun `entries missing filename or content are skipped`() {
        val files = parse(
            """{"files":[
                {"filename":"only-name.md"},
                {"content":"only content"},
                {"filename":"ok.md","content":"body"}
            ]}""",
        )
        assertEquals(1, files.size)
        assertEquals("ok.md", files[0].filename)
        assertEquals("body", files[0].content)
    }
}
