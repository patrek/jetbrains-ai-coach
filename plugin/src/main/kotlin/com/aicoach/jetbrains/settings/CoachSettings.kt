package com.aicoach.jetbrains.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

/**
 * Application-level persisted settings.
 *
 * Two user-facing controls:
 *  - [nodePath]: the detection cascade ([com.aicoach.jetbrains.sidecar.NodeDetector])
 *    consults it first, so a user whose Node lives somewhere the cascade can't
 *    find can point the plugin at it directly.
 *  - [excludedDirs]: directories the sidecar must NOT scan (privacy control that
 *    accompanies the first-run data-access disclosure). Passed to the sidecar via
 *    the `AI_COACH_EXCLUDED_DIRS` environment variable.
 */
@State(
    name = "AiCoachSettings",
    storages = [Storage("aiCoach.xml")],
)
class CoachSettings : PersistentStateComponent<CoachSettings.State> {

    /** Serialized form. A blank [nodePath] means "no override — use the cascade". */
    class State {
        @JvmField
        var nodePath: String = ""

        /** Absolute directory paths the sidecar must skip when scanning logs. */
        @JvmField
        var excludedDirs: MutableList<String> = mutableListOf()
    }

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        XmlSerializerUtil.copyBean(state, this.state)
    }

    /** Absolute path to a Node executable, or `null` when no override is set. */
    var nodePath: String?
        get() = state.nodePath.trim().ifEmpty { null }
        set(value) {
            state.nodePath = value?.trim().orEmpty()
        }

    /**
     * Directories excluded from scanning. Blank lines are dropped and entries are
     * trimmed so the serialized form stays clean regardless of UI input.
     */
    var excludedDirs: List<String>
        get() = state.excludedDirs.toList()
        set(value) {
            state.excludedDirs = value.map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()
        }

    companion object {
        fun getInstance(): CoachSettings =
            ApplicationManager.getApplication().getService(CoachSettings::class.java)
    }
}
