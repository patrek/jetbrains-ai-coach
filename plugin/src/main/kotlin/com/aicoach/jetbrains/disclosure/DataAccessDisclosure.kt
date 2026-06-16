package com.aicoach.jetbrains.disclosure

import com.aicoach.jetbrains.settings.CoachSettingsConfigurable
import com.intellij.ide.util.PropertiesComponent
import com.intellij.notification.Notification
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project

/**
 * First-run data-access disclosure (JetBrains Marketplace requirement).
 *
 * Shown once, at the point of first data access (the dashboard's first open),
 * before the sidecar scans anything. It states plainly that the plugin reads the
 * listed directories read-only, keeps everything local, and sends zero
 * telemetry — and points at the exclusion setting for opting directories out.
 *
 * Gated by an application-level flag so it never re-fires on later opens or in
 * other windows. The directory list and message body are pure functions so the
 * disclosed surface is unit-tested rather than asserted through a balloon.
 */
object DataAccessDisclosure {

    private const val SHOWN_KEY = "aicoach.disclosure.shown"
    private const val GROUP_ID = "AI Usage Coach Disclosure"

    /** One directory the plugin reads, with the harness it belongs to. */
    data class DataDir(val harness: String, val path: String)

    /**
     * The directories the sidecar reads, in the platform-neutral `~`-relative
     * form users recognize. Kept in sync with the sidecar's discovery
     * (`parser-harnesses.ts` + the patched `findLogsDirs`).
     */
    fun directories(): List<DataDir> = listOf(
        DataDir("Claude Code", "~/.claude"),
        DataDir("Codex CLI", "~/.codex"),
        DataDir("OpenCode", "~/.local/share/opencode"),
        DataDir("Copilot CLI", "~/.copilot"),
    )

    /** The disclosure body (HTML for the balloon). Pure — unit-tested directly. */
    fun message(dirs: List<DataDir> = directories()): String {
        val items = dirs.joinToString("") { "<li><code>${it.path}</code> — ${it.harness}</li>" }
        return "AI Usage Coach reads your local AI coding-assistant session logs to build its analytics. " +
            "It reads these directories <b>read-only</b>, keeps all data <b>on your machine</b>, and sends " +
            "<b>zero telemetry</b>:<ul>$items</ul>" +
            "Exclude any directory under <b>Settings → Tools → AI Usage Coach</b>."
    }

    fun maybeShow(project: Project) {
        val props = PropertiesComponent.getInstance()
        if (props.getBoolean(SHOWN_KEY, false)) return

        // Resolve the group BEFORE burning the one-time flag, so a missing group
        // never silently consumes the single chance to show the disclosure.
        val group = NotificationGroupManager.getInstance().getNotificationGroup(GROUP_ID) ?: return
        props.setValue(SHOWN_KEY, true)

        val notification = group.createNotification(
            "AI Usage Coach reads your local session logs",
            message(),
            NotificationType.INFORMATION,
        )
        notification.addAction(object : NotificationAction("Manage excluded directories") {
            override fun actionPerformed(e: AnActionEvent, notification: Notification) {
                ShowSettingsUtil.getInstance()
                    .showSettingsDialog(project, CoachSettingsConfigurable::class.java)
            }
        })
        notification.notify(project)
    }
}
