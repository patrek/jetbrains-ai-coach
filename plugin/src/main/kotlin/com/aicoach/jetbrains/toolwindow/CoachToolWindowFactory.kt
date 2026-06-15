package com.aicoach.jetbrains.toolwindow

import com.aicoach.jetbrains.jcef.AssetSchemeHandler
import com.aicoach.jetbrains.jcef.WebviewBridge
import com.aicoach.jetbrains.sidecar.NodeDetector
import com.aicoach.jetbrains.theme.ThemeCssProvider
import com.aicoach.jetbrains.theme.WebviewThemeSync
import com.aicoach.jetbrains.sidecar.SidecarService
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.util.concurrent.atomic.AtomicInteger
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * The dashboard tool window. Lazy and `DumbAware` so it opens during indexing.
 *
 * First-run reality is failure states, not a blank: JCEF may be unavailable,
 * Node may be missing/too-old/broken. Each is a designed panel — the JCEF gate
 * resolves synchronously (well within 2s); Node detection runs off the EDT and
 * swaps the panel in when it lands, with Retry that re-detects without an IDE
 * restart.
 */
class CoachToolWindowFactory : ToolWindowFactory, DumbAware {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val dashboard = CoachDashboard(project)
        Disposer.register(toolWindow.disposable, dashboard)
        val content = toolWindow.contentManager.factory.createContent(dashboard.root, "", false)
        content.isCloseable = false
        toolWindow.contentManager.addContent(content)
        dashboard.start()
    }
}

/** Orchestrates the gate -> detection -> browser flow for one tool window. */
internal class CoachDashboard(private val project: Project) : Disposable {

    val root: JPanel = JPanel(BorderLayout())
    private var disposed = false

    fun start() {
        if (!JBCefApp.isSupported()) {
            showCenter(jcefUnsupportedPanel())
            return
        }
        detectAndRender()
    }

    private fun detectAndRender() {
        showCenter(messagePanel("Detecting Node…", "Locating a Node.js runtime for the AI Coach sidecar."))
        ApplicationManager.getApplication().executeOnPooledThread {
            val result = NodeDetector.forCurrentSystem().detect()
            invokeOnUi {
                when (result) {
                    is NodeDetector.Result.Found -> launchBrowser(result.path)
                    is NodeDetector.Result.Missing -> showCenter(nodeMissingPanel(result.checked))
                    is NodeDetector.Result.TooOld -> showCenter(nodeTooOldPanel(result.version, result.required))
                    is NodeDetector.Result.Broken -> showCenter(nodeBrokenPanel(result.path, result.detail))
                }
            }
        }
    }

    private fun launchBrowser(nodePath: String) {
        val service = SidecarService.getInstance()
        val browser = JBCefBrowser()
        Disposer.register(this, browser)
        browser.component.background = panelBackground()

        // Order matters: register the per-window asset origin and create the
        // bridge (which creates its JBCefJSQuery) BEFORE the browser navigates.
        val domain = "aicoach-${DOMAIN_SEQ.incrementAndGet()}"
        val url = AssetSchemeHandler.register(
            domain,
            stateJsonProvider = { WebviewBridge.currentState(project) },
            themeScriptProvider = { ThemeCssProvider.forCurrentTheme().setPropertyScript() },
        )
        val bridge = WebviewBridge(project, browser, service)
        Disposer.register(this, bridge)
        WebviewThemeSync(browser, this)

        service.ensureStarted(nodePath)
        browser.loadURL(url)
        showCenter(browser.component)
    }

    // ---- panels ----------------------------------------------------------

    private fun jcefUnsupportedPanel(): JComponent = messagePanel(
        "Embedded browser unavailable",
        "The AI Coach dashboard needs the IDE's embedded browser (JCEF), which is not available in this IDE. " +
            "Enable it via Help → Find Action → \"Registry…\", set ide.browser.jcef.enabled to true, then restart the IDE.",
    )

    private fun nodeMissingPanel(checked: List<String>): JComponent = messagePanel(
        "Node.js not found",
        buildString {
            append("AI Coach needs Node.js ${NodeDetector.MIN_MAJOR} or newer. Install Node, or set its path in ")
            append("Settings → Tools → AI Coach, then Retry.\n\nLooked in:\n")
            append(checked.joinToString("\n") { "  • $it" })
        },
        retry = true,
    )

    private fun nodeTooOldPanel(detected: String, required: Int): JComponent = messagePanel(
        "Node.js is too old",
        "AI Coach needs Node.js $required or newer, but found $detected. Upgrade Node (or point Settings → " +
            "Tools → AI Coach at a newer install), then Retry.",
        retry = true,
    )

    private fun nodeBrokenPanel(path: String, detail: String): JComponent = messagePanel(
        "Node.js could not run",
        "The Node.js at $path failed to report its version:\n\n$detail\n\nFix the installation or set a different " +
            "path in Settings → Tools → AI Coach, then Retry.",
        retry = true,
    )

    private fun messagePanel(title: String, body: String, retry: Boolean = false): JComponent {
        val panel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.empty(24)
            background = panelBackground()
        }
        panel.add(JBLabel(title).apply {
            font = font.deriveFont(font.size2D + 3f)
            alignmentX = Component.LEFT_ALIGNMENT
        })
        panel.add(Box.createVerticalStrut(JBUI.scale(8)))
        // A multi-line body via an HTML label keeps wrapping simple.
        panel.add(JBLabel("<html><body style='width:340px'>${body.htmlEscapeWithBreaks()}</body></html>").apply {
            verticalAlignment = SwingConstants.TOP
            alignmentX = Component.LEFT_ALIGNMENT
        })
        if (retry) {
            panel.add(Box.createVerticalStrut(JBUI.scale(16)))
            panel.add(JButton("Retry").apply {
                alignmentX = Component.LEFT_ALIGNMENT
                addActionListener { detectAndRender() }
            })
        }
        return panel
    }

    // ---- helpers ---------------------------------------------------------

    private fun panelBackground(): Color = UIUtil.getPanelBackground() ?: JBColor.background()

    private fun showCenter(component: JComponent) {
        if (disposed) return
        root.removeAll()
        root.add(component, BorderLayout.CENTER)
        root.revalidate()
        root.repaint()
    }

    private fun invokeOnUi(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater({ if (!disposed) block() }, project.disposed)
    }

    override fun dispose() {
        disposed = true
    }

    private companion object {
        val DOMAIN_SEQ = AtomicInteger(0)
    }
}

private fun String.htmlEscapeWithBreaks(): String =
    replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
