package com.aicoach.jetbrains.export

import com.aicoach.jetbrains.sidecar.SidecarService
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.ide.actions.RevealFileAction
import com.intellij.notification.Notification
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files

/** One exported file: a date-stamped name plus its rendered content. */
data class ExportedFile(val filename: String, val content: String)

/**
 * Host-owned `exportSummary` flow (ADR 0009).
 *
 * The dashboard's "Export summary" action is routed here by the bridge. The
 * sidecar owns the analyzer, so it renders the files; this handler fetches them
 * via a host-originated call, then — on the EDT — shows an IntelliJ directory
 * chooser and writes the date-stamped files into the chosen folder. The webview
 * only learns `{ok|cancelled|error}`; the user-visible success/failure feedback
 * is an IDE notification balloon, and success offers "Show in Files".
 *
 * The date-filter context is preserved by forwarding the webview's `filter`
 * param unchanged to the sidecar, so the export matches what the user is viewing.
 *
 * Only the wire-parsing ([parseExportFiles]) is unit-tested; the JCEF/EDT/chooser
 * glue is verified manually (same precedent as the trust-gate UI glue).
 */
class ExportSummaryHandler(
    private val project: Project,
    private val service: SidecarService,
    private val projectRoot: String?,
) {

    /**
     * Run the export. [params] is the webview request's params (carrying the
     * date filter); [reply] delivers the response back to the webview.
     */
    fun export(params: JsonObject?, safeMode: Boolean, reply: (JsonObject) -> Unit) {
        val contentParams = JsonObject().apply {
            params?.get("filter")?.let { add("filter", it) }
        }
        service.hostCall("exportSummaryContent", contentParams, projectRoot, safeMode) { data ->
            onEdt { handleContent(data, reply) }
        }
    }

    private fun handleContent(data: JsonElement, reply: (JsonObject) -> Unit) {
        val obj = data as? JsonObject
        val errorMsg = obj?.get("error")?.asStringOrNull()
        if (obj == null || errorMsg != null) {
            val message = errorMsg ?: "Export failed: malformed sidecar response."
            notify(message, NotificationType.ERROR)
            reply(result(ok = false, error = message))
            return
        }

        val files = parseExportFiles(obj)
        if (files.isEmpty()) {
            notify("Nothing to export yet — the dashboard has no data.", NotificationType.WARNING)
            reply(result(ok = false))
            return
        }

        val descriptor = FileChooserDescriptorFactory.createSingleFolderDescriptor()
            .withTitle("Export AI Usage Coach Summary")
            .withDescription("Choose a folder for the summary files.")
        val dir: VirtualFile? = FileChooser.chooseFile(descriptor, project, project.guessProjectDir())
        if (dir == null) {
            reply(result(ok = false, cancelled = true))
            return
        }

        val written = try {
            writeFiles(File(dir.path), files)
        } catch (e: Exception) {
            log.warn("Summary export write failed", e)
            notify("Export failed: ${e.message}", NotificationType.ERROR)
            reply(result(ok = false, error = e.message ?: "write failed"))
            return
        }

        LocalFileSystem.getInstance().refreshAndFindFileByPath(dir.path)
        notifySuccess(written)
        reply(result(ok = true))
    }

    /** Write each file by basename only, so a hostile filename can't escape [dir]. */
    private fun writeFiles(dir: File, files: List<ExportedFile>): List<File> {
        val written = mutableListOf<File>()
        for (file in files) {
            val target = File(dir, File(file.filename).name)
            Files.write(target.toPath(), file.content.toByteArray(StandardCharsets.UTF_8))
            written.add(target)
        }
        return written
    }

    private fun notifySuccess(written: List<File>) {
        val group = NotificationGroupManager.getInstance().getNotificationGroup(GROUP_ID) ?: return
        val count = written.size
        val notification = group.createNotification(
            "AI Usage Coach",
            "Exported summary ($count file${if (count == 1) "" else "s"}).",
            NotificationType.INFORMATION,
        )
        written.firstOrNull()?.let { first ->
            notification.addAction(object : NotificationAction("Show in Files") {
                override fun actionPerformed(e: AnActionEvent, notification: Notification) {
                    RevealFileAction.openFile(first)
                }
            })
        }
        notification.notify(project)
    }

    private fun notify(content: String, type: NotificationType) {
        NotificationGroupManager.getInstance().getNotificationGroup(GROUP_ID)
            ?.createNotification("AI Usage Coach", content, type)
            ?.notify(project)
    }

    private fun onEdt(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater(
            { runCatching(block).onFailure { log.warn("Export UI action failed", it) } },
            { project.isDisposed },
        )
    }

    private fun result(ok: Boolean, cancelled: Boolean = false, error: String? = null): JsonObject =
        JsonObject().apply {
            addProperty("ok", ok)
            if (cancelled) addProperty("cancelled", true)
            if (error != null) addProperty("error", error)
        }

    companion object {
        private const val GROUP_ID = "AI Usage Coach"
        private val log = logger<ExportSummaryHandler>()
    }
}

/**
 * Parse `{ files: [{filename, content}, ...] }` from the sidecar into
 * [ExportedFile]s. Pure (gson-only) and IntelliJ-free so it is unit-testable
 * without the platform; entries missing a filename or content are skipped.
 */
internal fun parseExportFiles(data: JsonElement?): List<ExportedFile> {
    val obj = data as? JsonObject ?: return emptyList()
    val arr = obj.get("files") as? JsonArray ?: return emptyList()
    return arr.mapNotNull { el ->
        val o = el as? JsonObject ?: return@mapNotNull null
        val filename = o.get("filename")?.asStringOrNull() ?: return@mapNotNull null
        val content = o.get("content")?.asStringOrNull() ?: return@mapNotNull null
        ExportedFile(filename, content)
    }
}

private fun JsonElement.asStringOrNull(): String? =
    if (isJsonPrimitive && asJsonPrimitive.isString) asString else null
