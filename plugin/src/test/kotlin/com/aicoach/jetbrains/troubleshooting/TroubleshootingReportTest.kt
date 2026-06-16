package com.aicoach.jetbrains.troubleshooting

import com.aicoach.jetbrains.sidecar.NodeDetector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure tests for [TroubleshootingReport] — formatting, the Node-detection line
 *  for each outcome, and the bounded log tail. No IO, no platform. */
class TroubleshootingReportTest {

    private fun info(
        nodeDetection: NodeDetector.Result = NodeDetector.Result.Found("/usr/bin/node", "v20.11.0"),
        excludedDirs: List<String> = emptyList(),
        logTail: String = "",
    ) = TroubleshootingInfo(
        pluginVersion = "0.1.0",
        ide = "IntelliJ IDEA 2024.2.5 (build IC-242.0)",
        os = "Linux 6.17.0 (amd64)",
        javaVersion = "21.0.2",
        nodeOverride = null,
        nodeDetection = nodeDetection,
        excludedDirs = excludedDirs,
        runtimeDir = "/home/u/.ai-coach-jetbrains/runtime",
        cacheDir = "/home/u/.ai-coach-jetbrains/cache",
        logTail = logTail,
    )

    @Test
    fun `node detection line covers every outcome`() {
        assertTrue(
            TroubleshootingReport.nodeDetectionLine(NodeDetector.Result.Found("/n", "v20.0.0")).startsWith("OK"),
        )
        assertTrue(
            TroubleshootingReport.nodeDetectionLine(NodeDetector.Result.TooOld("/n", "v18.0.0", 20))
                .startsWith("Too old"),
        )
        assertTrue(
            TroubleshootingReport.nodeDetectionLine(NodeDetector.Result.Broken("/n", "ENOENT")).startsWith("Broken"),
        )
        val missing = TroubleshootingReport.nodeDetectionLine(NodeDetector.Result.Missing(listOf("/usr/bin", "/opt")))
        assertTrue(missing.startsWith("Not found"))
        assertTrue(missing.contains("/usr/bin"))
    }

    @Test
    fun `build includes environment facts and the override fallback`() {
        val report = TroubleshootingReport.build(info())
        assertTrue(report.contains("Plugin version : 0.1.0"))
        assertTrue(report.contains("IntelliJ IDEA 2024.2.5"))
        assertTrue(report.contains("Node override  : (auto-detect)"))
    }

    @Test
    fun `build shows a configured node override verbatim`() {
        val info = info().copy(nodeOverride = "/opt/node20/bin/node")
        assertTrue(TroubleshootingReport.build(info).contains("Node override  : /opt/node20/bin/node"))
    }

    @Test
    fun `tailLog keeps the log verbatim at the exact boundary`() {
        val log = (1..5).joinToString("\n") { "line$it" }
        val tailed = TroubleshootingReport.tailLog(log, maxLines = 5)
        assertEquals(log, tailed)
        assertFalse(tailed.contains("omitted"))
    }

    @Test
    fun `build lists excluded directories or marks none`() {
        assertTrue(TroubleshootingReport.build(info()).contains("Excluded dirs  : (none)"))
        val withDirs = TroubleshootingReport.build(info(excludedDirs = listOf("/home/u/.claude")))
        assertTrue(withDirs.contains("/home/u/.claude"))
    }

    @Test
    fun `build notes an empty log`() {
        assertTrue(TroubleshootingReport.build(info(logTail = "   ")).contains("(log is empty or missing)"))
    }

    @Test
    fun `tailLog keeps short logs verbatim`() {
        val log = "line1\nline2\nline3"
        assertEquals(log, TroubleshootingReport.tailLog(log, maxLines = 10))
    }

    @Test
    fun `tailLog truncates to the last lines with an omission marker`() {
        val log = (1..50).joinToString("\n") { "line$it" }
        val tailed = TroubleshootingReport.tailLog(log, maxLines = 5)
        assertTrue(tailed.contains("45 earlier lines omitted"))
        assertTrue(tailed.contains("line50"))
        assertFalse(tailed.contains("line1\n"))
    }
}
