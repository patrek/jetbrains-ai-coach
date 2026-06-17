package com.aicoach.jetbrains.settings

import com.aicoach.jetbrains.sidecar.CliProviderDetector
import com.aicoach.jetbrains.sidecar.SidecarService
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent

/**
 * Settings UI for the global, app-level controls: the Node executable override
 * (the detection cascade consults it first), the scanned-directory exclusion list
 * (the privacy control behind the first-run data-access disclosure), and the
 * **opt-in** CLI inference provider that powers the AI-backed dashboard actions.
 *
 * The provider is off (`Disabled`) until the user explicitly selects one and
 * acknowledges a one-time egress disclosure — switching away from `Disabled`
 * before consenting shows [ProviderLabels] a modal and reverts on decline, so no
 * prompt can ever leave the machine without an informed opt-in. The per-project
 * override lives in [CliProviderProjectConfigurable].
 */
class CoachSettingsConfigurable : Configurable {

    private var nodePathField: TextFieldWithBrowseButton? = null
    private var excludedDirsArea: JBTextArea? = null
    private var providerCombo: ComboBox<String>? = null

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

        val combo = ComboBox(ProviderLabels.displayNames.toTypedArray())
        providerCombo = combo

        return FormBuilder.createFormBuilder()
            .addLabeledComponent("Node executable path:", field)
            .addComponentToRightColumn(
                JBLabel("Leave blank to auto-detect (PATH, version-manager defaults, well-known locations)."),
            )
            .addLabeledComponent("Excluded directories:", JBScrollPane(excluded), true)
            .addComponentToRightColumn(
                JBLabel("One absolute path per line. The sidecar will not read these directories or their contents."),
            )
            .addLabeledComponent("AI inference provider:", combo)
            .addComponentToRightColumn(
                JBLabel("Powers \"Generate rule\" and \"Explain\". Off by default; sends prompts derived from your logs to the selected CLI when used."),
            )
            .addComponentFillVertically(javax.swing.JPanel(), 0)
            .panel
    }

    override fun isModified(): Boolean =
        currentNodePath() != (CoachSettings.getInstance().nodePath ?: "") ||
            currentExcludedDirs() != CoachSettings.getInstance().excludedDirs ||
            selectedProviderId() != CoachSettings.getInstance().providerId

    override fun apply() {
        val settings = CoachSettings.getInstance()
        val exclusionsChanged = currentExcludedDirs() != settings.excludedDirs
        settings.nodePath = currentNodePath()
        settings.excludedDirs = currentExcludedDirs()
        applyProviderSelection(settings)
        // Apply the new scan scope to a running sidecar without an IDE restart.
        if (exclusionsChanged) SidecarService.getInstance().reloadExcludedDirs()
        // Detection is memoized app-level; a settings change must re-probe.
        CliProviderDetector.getInstance().invalidate()
    }

    /**
     * Persist the provider choice, gating the first enable on the egress modal.
     * Selecting a provider before consent shows the disclosure: on acknowledge it
     * records consent and the choice; on decline it reverts the combo and settings
     * to `Disabled` so nothing is ever sent.
     */
    private fun applyProviderSelection(settings: CoachSettings) {
        val chosen = selectedProviderId()
        if (chosen.isNotEmpty() && !settings.providerEgressConsented) {
            if (confirmEgress(chosen)) {
                settings.providerEgressConsented = true
                settings.providerId = chosen
            } else {
                settings.providerId = ""
                providerCombo?.selectedItem = ProviderLabels.displayFor("")
            }
            return
        }
        settings.providerId = chosen
    }

    private fun confirmEgress(providerId: String): Boolean = Messages.showYesNoDialog(
        "Enabling ${ProviderLabels.displayFor(providerId)} lets the AI Usage Coach send prompts " +
            "derived from your usage logs to that CLI, which forwards them to a network language model.\n\n" +
            "Until now this plugin has stayed entirely local. Continue?",
        "Enable AI Inference Provider",
        "Enable",
        "Keep Disabled",
        Messages.getWarningIcon(),
    ) == Messages.YES

    override fun reset() {
        nodePathField?.text = CoachSettings.getInstance().nodePath ?: ""
        excludedDirsArea?.text = CoachSettings.getInstance().excludedDirs.joinToString("\n")
        providerCombo?.selectedItem = ProviderLabels.displayFor(CoachSettings.getInstance().providerId)
    }

    override fun disposeUIResources() {
        nodePathField = null
        excludedDirsArea = null
        providerCombo = null
    }

    private fun currentNodePath(): String = nodePathField?.text?.trim().orEmpty()

    /** The text area split into trimmed, non-blank lines — the canonical list shape. */
    private fun currentExcludedDirs(): List<String> =
        excludedDirsArea?.text.orEmpty()
            .split('\n')
            .map { it.trim() }
            .filter { it.isNotEmpty() }

    private fun selectedProviderId(): String =
        ProviderLabels.idFor(providerCombo?.selectedItem as? String)
}
