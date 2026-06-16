package com.aicoach.jetbrains.troubleshooting

import com.aicoach.jetbrains.sidecar.NodeDetector

/** The gathered facts a troubleshooting report is rendered from. */
data class TroubleshootingInfo(
    val pluginVersion: String,
    val ide: String,
    val os: String,
    val javaVersion: String,
    val nodeOverride: String?,
    val nodeDetection: NodeDetector.Result,
    val excludedDirs: List<String>,
    val runtimeDir: String,
    val cacheDir: String,
    val logTail: String,
)

/**
 * Renders a [TroubleshootingInfo] into a plain-text bug-report bundle. Pure (no
 * IO, no platform calls) so the report's shape and redaction are unit-tested;
 * the action is the thin gatherer around it.
 */
object TroubleshootingReport {

    private const val MAX_LOG_LINES = 200

    /** One human-readable line summarizing the Node detection outcome. */
    fun nodeDetectionLine(result: NodeDetector.Result): String = when (result) {
        is NodeDetector.Result.Found -> "OK — Node ${result.version} at ${result.path}"
        is NodeDetector.Result.TooOld ->
            "Too old — Node ${result.version} at ${result.path} (need ${result.required}+)"
        is NodeDetector.Result.Broken -> "Broken — ${result.path}: ${result.detail}"
        is NodeDetector.Result.Missing ->
            "Not found — looked in:\n" + result.checked.joinToString("\n") { "    $it" }
    }

    /** Keep only the last [MAX_LOG_LINES] log lines so the report stays bounded. */
    fun tailLog(log: String, maxLines: Int = MAX_LOG_LINES): String {
        val lines = log.trimEnd().split('\n')
        if (lines.size <= maxLines) return log.trimEnd()
        return "[… ${lines.size - maxLines} earlier lines omitted …]\n" +
            lines.takeLast(maxLines).joinToString("\n")
    }

    fun build(info: TroubleshootingInfo): String = buildString {
        appendLine("AI Usage Coach — Troubleshooting Report")
        appendLine("========================================")
        appendLine("Plugin version : ${info.pluginVersion}")
        appendLine("IDE            : ${info.ide}")
        appendLine("OS             : ${info.os}")
        appendLine("Java           : ${info.javaVersion}")
        appendLine("Node override  : ${info.nodeOverride ?: "(auto-detect)"}")
        appendLine("Node detection : ${nodeDetectionLine(info.nodeDetection)}")
        appendLine("Runtime dir    : ${info.runtimeDir}")
        appendLine("Cache dir      : ${info.cacheDir}")
        appendLine("Excluded dirs  : ${if (info.excludedDirs.isEmpty()) "(none)" else ""}")
        info.excludedDirs.forEach { appendLine("    $it") }
        appendLine()
        appendLine("--- sidecar log (last $MAX_LOG_LINES lines) ---")
        val log = info.logTail.trim()
        append(if (log.isEmpty()) "(log is empty or missing)" else tailLog(log))
    }
}
