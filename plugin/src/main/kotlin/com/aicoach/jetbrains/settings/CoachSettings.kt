package com.aicoach.jetbrains.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

/**
 * Application-level persisted settings.
 *
 * Part 3 scope is deliberately the Node path override only — the detection
 * cascade ([com.aicoach.jetbrains.sidecar.NodeDetector]) consults [nodePath]
 * first, so a user whose Node lives somewhere the cascade can't find can point
 * the plugin at it directly. "Clear analytics cache" (part 7) and log-dir
 * overrides (out of scope) are intentionally absent.
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

    companion object {
        fun getInstance(): CoachSettings =
            ApplicationManager.getApplication().getService(CoachSettings::class.java)
    }
}
