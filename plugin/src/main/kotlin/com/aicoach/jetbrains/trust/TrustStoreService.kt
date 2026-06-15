package com.aicoach.jetbrains.trust

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.RoamingType
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

/**
 * Host-side persistent store backing the sidecar's `TrustMemento` RPC contract
 * ([ADR 0005](docs/ADR/0005-kotlin-side-trust-store.md), decision D5).
 *
 * Approval authority for untrusted local rules lives on the Kotlin host, not in
 * a user-writable file sitting next to the rules it governs. The sidecar reads
 * the full memento snapshot via `trust/get` ([snapshot]) and persists individual
 * keys via `trust/update` ([put]).
 *
 * This store is intentionally generic over keys and JSON values: it knows
 * nothing about the approval-map shape. In practice it holds a single key,
 * `"aiEngineerCoach.ruleTrust.v1"`, mapping absolute file paths to
 * `{ hash, approvedAt }` records, but that structure is owned by the sidecar.
 *
 * Approvals are intentionally **per-host-app** and never roam: [RoamingType.DISABLED]
 * keeps trust state from syncing across machines, so a rule approved on one host
 * stays pending on another until explicitly approved there.
 */
@Service(Service.Level.APP)
@State(
    name = "AiCoachRuleTrust",
    storages = [Storage("aiCoachRuleTrust.xml", roamingType = RoamingType.DISABLED)],
)
class TrustStoreService : PersistentStateComponent<TrustStoreService.State> {

    /** mementoKey -> raw JSON string of its value. A `MutableMap<String, String>`
     * serializes natively via the platform's XmlSerializer. */
    class State {
        @JvmField
        var entries: MutableMap<String, String> = mutableMapOf()
    }

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    /** Full memento snapshot for `trust/get`. Malformed stored values are skipped. */
    @Synchronized
    fun snapshot(): JsonObject {
        val result = JsonObject()
        for ((key, raw) in state.entries) {
            val parsed = try {
                JsonParser.parseString(raw)
            } catch (_: Exception) {
                continue
            }
            result.add(key, parsed)
        }
        return result
    }

    /** Persist a single memento key for `trust/update`. */
    @Synchronized
    fun put(key: String, value: JsonElement) {
        state.entries[key] = value.toString()
    }

    /** Drop all persisted entries (diagnostics/tests). */
    @Synchronized
    fun clear() {
        state.entries.clear()
    }

    companion object {
        fun getInstance(): TrustStoreService = service<TrustStoreService>()
    }
}
