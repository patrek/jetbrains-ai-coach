package com.aicoach.jetbrains.mcp

import com.aicoach.jetbrains.sidecar.SidecarRuntime
import com.intellij.ide.util.PropertiesComponent
import com.intellij.notification.Notification
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import java.awt.datatransfer.StringSelection

/**
 * One-time balloon pointing users at the standalone MCP server (ADR 0002): the
 * same analytics, usable from Claude Code with the IDE closed. Setup is docs, not
 * a dialog (KISS) — the balloon just offers to copy the `claude mcp add` command
 * whose path (`runtime/current/`) survives plugin updates.
 *
 * Shown at most once per installation, gated by an application-level flag so it
 * never re-fires on later dashboard opens or other windows.
 */
object McpDiscoveryNotifier {

    private const val SHOWN_KEY = "aicoach.mcp.discoveryShown"
    private const val GROUP_ID = "AI Usage Coach"

    /** The command users paste into a terminal to register the MCP server. */
    fun setupCommand(): String = "claude mcp add aicoach -- node ${SidecarRuntime.mcpMainPath}"

    fun maybeNotify(project: Project) {
        val props = PropertiesComponent.getInstance()
        if (props.getBoolean(SHOWN_KEY, false)) return

        // Resolve the group BEFORE burning the one-time flag, so a missing group
        // never silently consumes the single chance to show the balloon.
        val group = NotificationGroupManager.getInstance().getNotificationGroup(GROUP_ID) ?: return
        props.setValue(SHOWN_KEY, true)
        val notification = group.createNotification(
            "AI Usage Coach analytics in Claude Code",
            "The same analytics are available as MCP tools in Claude Code — even with the IDE closed. " +
                "Run the setup command in a terminal to register them.",
            NotificationType.INFORMATION,
        )
        notification.addAction(object : NotificationAction("Copy setup command") {
            override fun actionPerformed(e: AnActionEvent, notification: Notification) {
                CopyPasteManager.getInstance().setContents(StringSelection(setupCommand()))
            }
        })
        notification.notify(project)
    }
}
