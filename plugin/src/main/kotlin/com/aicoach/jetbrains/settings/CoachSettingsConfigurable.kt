package com.aicoach.jetbrains.settings

import com.aicoach.jetbrains.sidecar.SidecarService
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent

/**
 * Settings UI for the two persisted controls: the Node executable override (the
 * detection cascade consults it first) and the scanned-directory exclusion list
 * (the privacy control behind the first-run data-access disclosure).
 */
class CoachSettingsConfigurable : Configurable {

    private var nodePathField: TextFieldWithBrowseButton? = null
    private var excludedDirsArea: JBTextArea? = null

    override fun getDisplayName(): String = "AI Usage Coach"

    override fun createComponent(): JComponent {
        val field = TextFieldWithBrowseButton()
        field.addBrowseFolderListener(
            "Select Node Executable",
            "Path to the Node.js executable used to run the AI Usage Coach sidecar",
            null,
            FileChooserDescriptorFactory.createSingleFileNoJarsDescriptor(),
        )
        nodePathField = field

        val excluded = JBTextArea(5, 40)
        excluded.lineWrap = false
        excludedDirsArea = excluded

        return FormBuilder.createFormBuilder()
            .addLabeledComponent("Node executable path:", field)
            .addComponentToRightColumn(
                JBLabel("Leave blank to auto-detect (PATH, version-manager defaults, well-known locations)."),
            )
            .addLabeledComponent("Excluded directories:", JBScrollPane(excluded), true)
            .addComponentToRightColumn(
                JBLabel("One absolute path per line. The sidecar will not read these directories or their contents."),
            )
            .addComponentFillVertically(javax.swing.JPanel(), 0)
            .panel
    }

    override fun isModified(): Boolean =
        currentNodePath() != (CoachSettings.getInstance().nodePath ?: "") ||
            currentExcludedDirs() != CoachSettings.getInstance().excludedDirs

    override fun apply() {
        val settings = CoachSettings.getInstance()
        val exclusionsChanged = currentExcludedDirs() != settings.excludedDirs
        settings.nodePath = currentNodePath()
        settings.excludedDirs = currentExcludedDirs()
        // Apply the new scan scope to a running sidecar without an IDE restart.
        if (exclusionsChanged) SidecarService.getInstance().reloadExcludedDirs()
    }

    override fun reset() {
        nodePathField?.text = CoachSettings.getInstance().nodePath ?: ""
        excludedDirsArea?.text = CoachSettings.getInstance().excludedDirs.joinToString("\n")
    }

    override fun disposeUIResources() {
        nodePathField = null
        excludedDirsArea = null
    }

    private fun currentNodePath(): String = nodePathField?.text?.trim().orEmpty()

    /** The text area split into trimmed, non-blank lines — the canonical list shape. */
    private fun currentExcludedDirs(): List<String> =
        excludedDirsArea?.text.orEmpty()
            .split('\n')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
}
