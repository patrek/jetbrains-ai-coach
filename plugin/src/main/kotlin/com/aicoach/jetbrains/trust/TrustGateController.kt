package com.aicoach.jetbrains.trust

import com.aicoach.jetbrains.sidecar.SidecarService
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.intellij.ide.impl.isTrusted
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project

/** One trust-pending local rule/metric, as surfaced by the sidecar. */
data class PendingRule(
    val filePath: String,
    val layer: String,
    val kind: String,
    val hash: String,
)

/**
 * Per-window orchestrator for the rule trust gate (decision D5).
 *
 * Owns the conversation with the shared sidecar's `getLocalRulesPending` /
 * `approveLocalRules` / `reloadLocalRules` methods, surfaces the "N local rules
 * pending review" balloon, opens [TrustApprovalDialog], and re-checks trust when
 * the on-disk rule/metric files change ([LocalRuleWatcher]).
 *
 * Approval is sidecar-driven (the TOCTOU hash guard lives in `rule-scope.ts`);
 * this controller only forwards the chosen file paths. Every sidecar call carries
 * the project root and the project's safe-mode (untrusted) state so the sidecar
 * scopes the project rule layer correctly and hard-blocks it under safe mode.
 */
class TrustGateController(
    private val project: Project,
    private val service: SidecarService,
    private val projectRoot: String?,
) : Disposable {

    private val watcher = LocalRuleWatcher(projectRoot, ::onRulesChangedOnDisk)

    /** Untrusted IntelliJ projects ("safe mode") get the project layer blocked.
     *  Public so the bridge stamps the same flag on every forwarded webview
     *  request, keeping project-layer scoping consistent across both paths. */
    fun safeMode(): Boolean = !project.isTrusted()

    fun start() {
        watcher.start()
    }

    /** Called once the sidecar handshake completes: proactively surface a balloon
     *  if anything is already pending. */
    fun onConnected() {
        fetchPending { pending -> if (pending.isNotEmpty()) notifyPending(pending.size) }
    }

    /** Webview `reviewLocalRules` interception — open the review dialog. */
    fun review() {
        fetchPending(::showDialog)
    }

    private fun onRulesChangedOnDisk() {
        // A disk edit may have invalidated a previously-approved hash. Force a
        // gated reload and re-surface the balloon if anything is (now) pending.
        service.hostCall("reloadLocalRules", null, projectRoot, safeMode()) { data ->
            val pending = parsePendingRules(data)
            onEdt { if (pending.isNotEmpty()) notifyPending(pending.size) }
        }
    }

    private fun fetchPending(onResult: (List<PendingRule>) -> Unit) {
        service.hostCall("getLocalRulesPending", null, projectRoot, safeMode()) { data ->
            val pending = parsePendingRules(data)
            onEdt { onResult(pending) }
        }
    }

    private fun showDialog(pending: List<PendingRule>) {
        if (pending.isEmpty()) {
            notifyNothingPending()
            return
        }
        val dialog = TrustApprovalDialog(project, pending)
        if (dialog.showAndGet() && dialog.approvedPaths.isNotEmpty()) {
            approve(dialog.approvedPaths)
        }
    }

    private fun approve(filePaths: List<String>) {
        val params = JsonObject().apply {
            add("filePaths", JsonArray().apply { filePaths.forEach { add(JsonPrimitive(it)) } })
        }
        service.hostCall("approveLocalRules", params, projectRoot, safeMode()) { data ->
            val remaining = parsePendingRules(data)
            onEdt {
                val approved = filePaths.size
                notify(
                    "Approved $approved local rule${if (approved == 1) "" else "s"}." +
                        if (remaining.isNotEmpty()) " ${remaining.size} still pending." else "",
                    NotificationType.INFORMATION,
                )
            }
        }
    }

    private fun notifyPending(count: Int) {
        val group = NotificationGroupManager.getInstance().getNotificationGroup(GROUP_ID) ?: return
        val notification = group.createNotification(
            "AI Usage Coach",
            "$count local rule${if (count == 1) "" else "s"} pending review.",
            NotificationType.WARNING,
        )
        notification.addAction(object : com.intellij.openapi.actionSystem.AnAction("Review") {
            override fun actionPerformed(e: com.intellij.openapi.actionSystem.AnActionEvent) {
                notification.expire()
                review()
            }
        })
        notification.notify(project)
    }

    private fun notifyNothingPending() {
        notify("No local rules are pending review.", NotificationType.INFORMATION)
    }

    private fun notify(content: String, type: NotificationType) {
        NotificationGroupManager.getInstance().getNotificationGroup(GROUP_ID)
            ?.createNotification("AI Usage Coach", content, type)
            ?.notify(project)
    }

    private fun onEdt(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(
            { runCatching(block).onFailure { log.warn("Trust controller UI action failed", it) } },
            { project.isDisposed },
        )
    }

    override fun dispose() {
        watcher.dispose()
    }

    companion object {
        private const val GROUP_ID = "AI Usage Coach Trust"
        private val log = logger<TrustGateController>()
    }
}

/**
 * Parse a `{ pending: [{filePath, layer, kind, hash}, ...] }` response into
 * [PendingRule]s. Pure (gson-only) and IntelliJ-free so it is unit-testable
 * without the platform; malformed entries are skipped rather than throwing.
 */
internal fun parsePendingRules(data: JsonElement?): List<PendingRule> {
    val obj = data as? JsonObject ?: return emptyList()
    val arr = obj.get("pending") as? JsonArray ?: return emptyList()
    return arr.mapNotNull { el ->
        val o = el as? JsonObject ?: return@mapNotNull null
        val filePath = o.get("filePath")?.asTrustString() ?: return@mapNotNull null
        PendingRule(
            filePath = filePath,
            layer = o.get("layer")?.asTrustString() ?: "personal",
            kind = o.get("kind")?.asTrustString() ?: "rule",
            hash = o.get("hash")?.asTrustString() ?: "",
        )
    }
}

private fun JsonElement.asTrustString(): String? =
    if (isJsonPrimitive && asJsonPrimitive.isString) asString else null
