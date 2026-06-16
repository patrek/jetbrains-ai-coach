package com.aicoach.jetbrains.troubleshooting

import com.aicoach.jetbrains.settings.CoachSettings
import com.aicoach.jetbrains.sidecar.NodeDetector
import com.aicoach.jetbrains.sidecar.SidecarRuntime
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import java.awt.datatransfer.StringSelection
import java.nio.file.Files
import java.nio.file.Path

/**
 * "Collect AI Usage Coach Troubleshooting Info" (Help menu): gathers the sidecar
 * log, Node detection results, and environment into one report and copies it to
 * the clipboard for pasting into a bug report.
 *
 * Node detection spawns `node --version`, so gathering runs off the EDT; the
 * clipboard write and the confirmation balloon run back on the EDT. The report
 * text itself is built by the pure [TroubleshootingReport].
 */
class CollectTroubleshootingInfoAction : AnAction() {

    private companion object {
        const val PLUGIN_ID = "com.aicoach.jetbrains"
        const val GROUP_ID = "AI Usage Coach"
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        ApplicationManager.getApplication().executeOnPooledThread {
            val report = TroubleshootingReport.build(gather())
            ApplicationManager.getApplication().invokeLater {
                CopyPasteManager.getInstance().setContents(StringSelection(report))
                NotificationGroupManager.getInstance().getNotificationGroup(GROUP_ID)
                    ?.createNotification(
                        "Troubleshooting info copied",
                        "The AI Usage Coach troubleshooting report is on your clipboard — paste it into your bug report.",
                        NotificationType.INFORMATION,
                    )
                    ?.notify(project)
            }
        }
    }

    private fun gather(): TroubleshootingInfo {
        val appInfo = ApplicationInfo.getInstance()
        val runtimeDir = SidecarRuntime.baseDir.resolve("runtime")
        val cacheDir = SidecarRuntime.baseDir.resolve("cache")
        return TroubleshootingInfo(
            pluginVersion = PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID))?.version ?: "(unknown)",
            ide = "${appInfo.fullApplicationName} (build ${appInfo.build.asString()})",
            os = "${System.getProperty("os.name")} ${System.getProperty("os.version")} (${System.getProperty("os.arch")})",
            javaVersion = System.getProperty("java.version") ?: "(unknown)",
            nodeOverride = CoachSettings.getInstance().nodePath,
            nodeDetection = NodeDetector.forCurrentSystem().detect(),
            excludedDirs = CoachSettings.getInstance().excludedDirs,
            runtimeDir = runtimeDir.toString(),
            cacheDir = cacheDir.toString(),
            logTail = readLog(SidecarRuntime.logFile),
        )
    }

    private fun readLog(log: Path): String =
        runCatching { if (Files.exists(log)) Files.readString(log) else "" }.getOrDefault("")
}
