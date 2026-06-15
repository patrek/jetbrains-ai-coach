package com.aicoach.jetbrains.trust

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure logic for [TrustStoreService]: [TrustStoreService.snapshot],
 * [TrustStoreService.put], and state load/store only touch local state plus
 * gson, so the service is instantiated directly with no platform container.
 */
class TrustStoreServiceTest {

    private val ruleTrustKey = "aiEngineerCoach.ruleTrust.v1"

    private fun approvalMap(path: String, hash: String, approvedAt: Long): JsonObject {
        val record = JsonObject().apply {
            addProperty("hash", hash)
            addProperty("approvedAt", approvedAt)
        }
        return JsonObject().apply { add(path, record) }
    }

    @Test
    fun `put then snapshot round-trips a nested json value`() {
        val store = TrustStoreService()
        val value = approvalMap("/abs/rule.md", "abc123", 1_700_000_000_000L)

        store.put(ruleTrustKey, value)

        val snapshot = store.snapshot()
        assertEquals(value, snapshot.get(ruleTrustKey))
    }

    @Test
    fun `multiple keys coexist in the snapshot`() {
        val store = TrustStoreService()
        val trust = approvalMap("/abs/rule.md", "abc123", 1L)
        val other = JsonPrimitive("just-a-string")

        store.put(ruleTrustKey, trust)
        store.put("some.other.key", other)

        val snapshot = store.snapshot()
        assertEquals(trust, snapshot.get(ruleTrustKey))
        assertEquals(other, snapshot.get("some.other.key"))
    }

    @Test
    fun `loadState reflects a pre-populated entries map`() {
        val store = TrustStoreService()
        val value = approvalMap("/abs/rule.md", "deadbeef", 42L)
        val state = TrustStoreService.State().apply {
            entries[ruleTrustKey] = value.toString()
        }

        store.loadState(state)

        assertEquals(value, store.snapshot().get(ruleTrustKey))
    }

    @Test
    fun `malformed stored value is skipped not thrown`() {
        val store = TrustStoreService()
        val good = approvalMap("/abs/good.md", "ok", 1L)
        val state = TrustStoreService.State().apply {
            entries["bad"] = "{ not valid json"
            entries[ruleTrustKey] = good.toString()
        }

        store.loadState(state)

        val snapshot = store.snapshot()
        assertFalse(snapshot.has("bad"))
        assertEquals(good, snapshot.get(ruleTrustKey))
    }

    @Test
    fun `put overwrites an existing key`() {
        val store = TrustStoreService()
        store.put(ruleTrustKey, approvalMap("/abs/rule.md", "old", 1L))
        val replacement = approvalMap("/abs/rule.md", "new", 2L)

        store.put(ruleTrustKey, replacement)

        assertEquals(replacement, store.snapshot().get(ruleTrustKey))
    }

    @Test
    fun `state survives a getState then loadState cycle`() {
        val store = TrustStoreService()
        store.put(ruleTrustKey, approvalMap("/abs/rule.md", "h", 9L))

        val reloaded = TrustStoreService()
        reloaded.loadState(store.getState())

        assertEquals(
            JsonParser.parseString(store.getState().entries.getValue(ruleTrustKey)),
            reloaded.snapshot().get(ruleTrustKey),
        )
    }
}
