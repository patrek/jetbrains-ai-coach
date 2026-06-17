package com.aicoach.jetbrains.settings

import com.aicoach.jetbrains.sidecar.CliProviderDetector
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent

/**
 * Per-project override of the global AI inference provider. Stored as a single
 * project-scoped string in [PropertiesComponent] (no `PersistentStateComponent`
 * service — the same store the webview bridge already uses for per-project state).
 *
 * "Use global default" (the empty value) makes the window inherit
 * [CoachSettings.providerId]; choosing a provider here resolves over the global
 * default (the bridge's `effectiveProvider`). Egress consent is global, recorded
 * once in [CoachSettingsConfigurable]; this control does not re-prompt.
 */
class CliProviderProjectConfigurable(private val project: Project) : Configurable {

    private var overrideCombo: ComboBox<String>? = null

    override fun getDisplayName(): String = "AI Inference Provider"

    override fun createComponent(): JComponent {
        val combo = ComboBox(ProviderLabels.overrideDisplayNames.toTypedArray())
        overrideCombo = combo
        return FormBuilder.createFormBuilder()
            .addLabeledComponent("Provider for this project:", combo)
            .addComponentToRightColumn(
                JBLabel("Overrides the global default (Settings ▸ Tools ▸ AI Usage Coach) for this project only."),
            )
            .addComponentFillVertically(javax.swing.JPanel(), 0)
            .panel
    }

    override fun isModified(): Boolean = selectedOverrideId() != storedOverride()

    override fun apply() {
        properties().setValue(CoachSettings.PROVIDER_OVERRIDE_KEY, selectedOverrideId(), "")
        // Detection is memoized app-level; a selection change must re-probe.
        CliProviderDetector.getInstance().invalidate()
    }

    override fun reset() {
        overrideCombo?.selectedItem = ProviderLabels.overrideDisplayFor(storedOverride())
    }

    override fun disposeUIResources() {
        overrideCombo = null
    }

    private fun selectedOverrideId(): String =
        ProviderLabels.overrideIdFor(overrideCombo?.selectedItem as? String)

    private fun storedOverride(): String =
        properties().getValue(CoachSettings.PROVIDER_OVERRIDE_KEY, "")

    private fun properties() = PropertiesComponent.getInstance(project)
}
