package com.aicoach.jetbrains.settings

/**
 * The single source of truth mapping CLI provider ids (the wire/storage form) to
 * the human labels shown in the two settings dropdowns. The global control's
 * empty option reads "Disabled"; the per-project override's reads "Use global
 * default" — otherwise the provider names are identical.
 */
object ProviderLabels {
    const val CLAUDE = "claude"
    const val COPILOT = "copilot"

    private const val CLAUDE_LABEL = "Claude Code"
    private const val COPILOT_LABEL = "GitHub Copilot CLI"
    private const val DISABLED = "Disabled"
    private const val INHERIT = "Use global default"

    /** Display labels for the app-level global-default dropdown (empty = Disabled). */
    val displayNames: List<String> = labels(DISABLED).values.toList()

    fun displayFor(id: String): String = labels(DISABLED)[id] ?: DISABLED

    fun idFor(display: String?): String = idIn(labels(DISABLED), display)

    /** Display labels for the project-level override dropdown (empty = inherit). */
    val overrideDisplayNames: List<String> = labels(INHERIT).values.toList()

    fun overrideDisplayFor(id: String): String = labels(INHERIT)[id] ?: INHERIT

    fun overrideIdFor(display: String?): String = idIn(labels(INHERIT), display)

    private fun labels(emptyLabel: String): Map<String, String> = linkedMapOf(
        "" to emptyLabel,
        CLAUDE to CLAUDE_LABEL,
        COPILOT to COPILOT_LABEL,
    )

    private fun idIn(map: Map<String, String>, display: String?): String =
        map.entries.firstOrNull { it.value == display }?.key ?: ""
}
