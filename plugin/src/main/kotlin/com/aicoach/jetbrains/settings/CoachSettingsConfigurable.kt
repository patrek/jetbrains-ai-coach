package com.aicoach.jetbrains.settings

import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent

/**
 * Settings UI for the Node path override. Intentionally a single field: part 3
 * exposes only the override the detection cascade consults first.
 */
class CoachSettingsConfigurable : Configurable {

    private var nodePathField: TextFieldWithBrowseButton? = null

    override fun getDisplayName(): String = "AI Coach"

    override fun createComponent(): JComponent {
        val field = TextFieldWithBrowseButton()
        field.addBrowseFolderListener(
            "Select Node Executable",
            "Path to the Node.js executable used to run the AI Coach sidecar",
            null,
            FileChooserDescriptorFactory.createSingleFileNoJarsDescriptor(),
        )
        nodePathField = field

        return FormBuilder.createFormBuilder()
            .addLabeledComponent("Node executable path:", field)
            .addComponentToRightColumn(
                JBLabel("Leave blank to auto-detect (PATH, version-manager defaults, well-known locations)."),
            )
            .addComponentFillVertically(javax.swing.JPanel(), 0)
            .panel
    }

    override fun isModified(): Boolean =
        currentFieldValue() != (CoachSettings.getInstance().nodePath ?: "")

    override fun apply() {
        CoachSettings.getInstance().nodePath = currentFieldValue()
    }

    override fun reset() {
        nodePathField?.text = CoachSettings.getInstance().nodePath ?: ""
    }

    override fun disposeUIResources() {
        nodePathField = null
    }

    private fun currentFieldValue(): String = nodePathField?.text?.trim().orEmpty()
}
