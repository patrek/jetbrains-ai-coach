---
title: "feat(jetbrains): Kotlin shell — tool window, JCEF, bridge, Node detection, sidecar supervisor (part 3/7)"
type: feat
date: 2026-06-11
parent: docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md
---

## feat(jetbrains): Kotlin shell (tool window + JCEF + bridge + supervisor) - Standard

## Overview

The bulk of the Kotlin codebase: the tool window hosting JCEF, the custom scheme handler serving the byte-identical upstream webview bundle, the `WebviewBridge` RPC relay between JCEF and the sidecar, the Node detection cascade, the application-level sidecar supervisor, and settings. After this PR, the dashboard renders real data inside a JetBrains IDE.

## Problem Statement / Motivation

This is the genuinely new platform glue (parent plan estimates ~2–4k LOC). It is also where the highest platform risks live: JCEF availability, JBCefJSQuery threading, macOS GUI PATH quirks, process lifecycle. It cannot be split further without leaving the repo non-runnable mid-PR.

## Proposed Solution

- `CoachToolWindowFactory.kt`: `ToolWindowFactory` + `DumbAware`, lazy creation; `JBCefApp.isSupported()` gate → Swing fallback panel (explanation + `ide.browser.jcef.enabled` registry guidance) within 2s.
- `jcef/AssetSchemeHandler.kt`: serves `/webview/*` from the plugin JAR under a custom scheme (decision D7 — `loadHTML` breaks relative script resolution). Serves `index.html` with a **CSP equivalent to upstream `panel-html.ts:10-66`** (script-src restricted to the scheme, no remote origins) and inlines `window.__INITIAL_STATE__` (read synchronously from `PropertiesComponent` at request time) into `bootstrap.js`. Part 3 inlines only the **minimal anti-flash theme** (`background-color` + base text color) to avoid a white flash; the full 21-variable mapping and live re-injection are **part 4's** sole concern (`ThemeCssProvider.kt`) — part 3 must not own theme variables.
- `bootstrap.js`: defines `window.acquireVsCodeApi` before `app.js` loads (the `tests/e2e/harness.html:78-93` trick) — `postMessage` → JBCefJSQuery, `getState` → pre-seeded `__INITIAL_STATE__`, `setState` → in-page cache + async `persistState`.
- `jcef/WebviewBridge.kt`: JBCefJSQuery **created before browser initialization** (platform constraint); handlers off-EDT.
  - **Handshake (consume, don't exchange):** the sidecar emits its handshake **unprompted** as the first stdout line — `{type:'hello', version:'1.0.0', capabilities:{llm:false, github:false}}` (see `sidecar/src/rpc-server.ts`). The bridge must **parse this `hello` line** (it does not send a hello and must not block waiting to send/receive one), validate `version` against the expected `SIDECAR_PROTOCOL_VERSION` (surface a mismatch instead of proceeding), and release the queued messages on receipt. 10s connect timeout → error state.
  - **Per-request project scope (C1 — root PATH, not ID):** stamp each forwarded request envelope with the owning window's **project root absolute path** on a top-level `projectRoot` string field — exactly the field the sidecar reads (`rpc-server.ts` → `rpc-handlers.ts` feeds it into `getProjectRulesDir(projectRoot)`). Use `project.basePath` / `project.guessProjectDir()?.path`; an IntelliJ project *ID/locationHash is not a filesystem path* and would make every project-layer `saveRule` silently fail.
  - **Webview→host interception (mandatory — never forward):** `openExternal` → `BrowserUtil.browse`; `saveModelBudgets`/`loadModelBudgets` → `PropertiesComponent`; `reviewLocalRules` → trust dialog stub until part 5; `getCapabilities` → **`{llm:false, github:false, host:'jetbrains'}`** (merge the sidecar hello's capability flags — `github` gates `getSdlcGitHubData` per ADR 0009 — with the host field). These MUST be intercepted: the sidecar returns `Unknown method` for the budget/external/capabilities methods and a typed error for `reviewLocalRules` by design (ADR 0009 Host rows are the source of truth). `exportSummary` (part 6) should be reserved/stubbed so an early call doesn't forward to `Unknown method`.
  - **Sidecar→host channel demux (C2):** the same sidecar stdout stream carries `{type:'host-request', id, method, params}` (methods `trust/get`, `trust/update` — see `sidecar/src/host-shims.ts`). The bridge's stdout reader must **demultiplex**: `response`/`progress`/`dataReady` → the webview; `host-request` → a host-method router that replies `{type:'host-response', id, data}` correlating on `id`. Until `TrustStoreService` lands in part 5, answer `trust/get` → `{}` and `trust/update` → ack. A bridge that doesn't recognize `host-request` would mis-route it into the webview.
  - **Broadcast registry:** `SidecarService` holds a weak-reference set of live `WebviewBridge` instances; on a sidecar push (`progress`/`dataReady`) it iterates only live instances (all windows share the one app-level sidecar and the same global dataset, D4). Bridges register on tool-window open and deregister on dispose.
- `sidecar/NodeDetector.kt`: configured setting → PATH → well-known locations → manual picker; validates `node --version` ≥ 20 with 5s hang guard; distinct "missing" / "too old" / "broken" panels with Retry (no IDE restart). **Resolve version-manager defaults precisely, not by glob:** nvm → resolve `$NVM_DIR/alias/default` (or `~/.nvm/alias/default`) to the active version's `bin` (do NOT glob `~/.nvm/versions/node/*/bin` — it picks the lexicographically-highest, not the user's default); fnm → `~/.local/share/fnm/aliases/default/bin` (Linux) / `~/.fnm` (macOS); volta → `~/.volta/bin`; plus `/opt/homebrew/bin`, `/usr/local/bin`, `%ProgramFiles%\nodejs`. If a version-manager default can't be resolved cleanly, fall through to the manual picker rather than guessing.
- `sidecar/SidecarService.kt` + `SidecarProcess.kt`: app-level `@Service` singleton (decision D4), coroutine-spawned `GeneralCommandLine` + `KillableProcessHandler`. **`SidecarProcess.kt` owns NDJSON framing:** `addProcessListener` → line-buffered stdout → parse each JSON line → route to `SidecarService`, which dispatches `response`/`progress`/`dataReady` to registered bridges and `host-request` to the host router (C2). Crash → backoff restart (max 3) → error banner with "Restart sidecar" / "View logs" (`~/.ai-coach-jetbrains/logs/sidecar.log`); **restart counter resets after >30s of stable run or on a user-initiated "Restart sidecar"**. Orphan prevention (stdin-close contract + stale-PID sweep). **Runtime extraction to `runtime/<pluginVersion>/` with a hardcoded launch path** — the stable `runtime/current` indirection is deferred to **part 5** (its only consumer, the MCP `mcp-main.js` external config, doesn't exist until then). Shutdown flush (≤2s) before kill.
- `settings/CoachSettings.kt` + `CoachSettingsConfigurable.kt`: **Node path override only** for part 3. "Clear analytics cache" is deferred to **part 7** (with the data-access disclosure/exclusion settings) and "log-dir overrides" are out of scope for part 3 (no acceptance criterion needs them).

## Tasks

- [ ] `CoachToolWindowFactory.kt` + JCEF gate + Swing fallback panel
- [ ] `AssetSchemeHandler.kt` (CSP + state inlining + minimal anti-flash theme) + `index.html` + `bootstrap.js`
- [ ] Trusted Types spike (**timeboxed ≤1 day**): load the bundle in a Chromium matching the bundled JCEF (`JBCefApp.getCefApp().version`) with the same origin + served CSP, and confirm `trustedTypes.createPolicy(...)` resolves without error. **Done = pass or fail decided within the box;** on failure apply the documented 1-line CSP-directive fallback patch immediately and move on (do not open-endedly investigate).
- [ ] `WebviewBridge.kt` — creation order, off-EDT handlers, queue-until-`hello`, version check, **`projectRoot` (root path) stamping**, mandatory webview→host interception (with reconciled `getCapabilities` shape), **`host-request`/`host-response` demux + stubbed `trust/*` router**, broadcast via the live-bridge registry
- [ ] **Sidecar follow-up (wires C2 on the sidecar side):** in `sidecar/src/rpc-server.ts`, construct the trust memento **with** a `HostChannel` that emits `{type:'host-request', id, method, params}` and resolves on a matching `host-response`; consume `host-response` in `onLine` into a pending-request table; call `loadTrustSeed` at startup. Add a sidecar test driving a mock host that answers `trust/get`/`trust/update`. (Part 2 shipped the `host-shims` primitives but left the server using the no-channel in-memory memento.)
- [ ] `NodeDetector.kt` + the three failure panels with Retry (version-manager default resolution, not glob)
- [ ] `SidecarService.kt` / `SidecarProcess.kt` (supervisor, **NDJSON framing in `SidecarProcess`**, orphan handling, `runtime/<version>/` extraction, restart-counter reset rule, flush)
- [ ] `CoachSettings.kt` / Configurable (Node path override only)
- [ ] Tests land with the code: `SidecarService` lifecycle tests (spawn / crash-restart / dispose / orphan sweep); a **static mock-bridge harness** — a second `test-harness.html` mirroring `bootstrap.js` (upstream `tests/e2e/harness.html` pattern) that a developer/CI can open in a plain browser to validate the served bundle against a mock bridge (no live IDE / full Playwright runner required for part 3)

## Technical Considerations

- JBCefJSQuery handlers run on a CEF I/O thread — never touch Swing there.
- `OSProcessHandler.waitFor()` on EDT is an error on 2026.1+ — all process work via coroutines/BGT.
- Empty state must list the directories checked per harness (port-specific copy — the upstream empty state references VS Code sources).
- **One stdout stream, four message types in, two out.** The sidecar interleaves `hello` / `response` / `progress` / `dataReady` / `host-request` on stdout; the bridge must route by `type` and correlate `id` for both `response` (webview requests) and `host-response` (host-request replies) on separate pending tables. Treat the wire contract documented in `sidecar/src/rpc-server.ts:5-12` as authoritative.
- **`projectRoot` is a path, full stop.** Anywhere this plan or the parent says "project ID" for the envelope stamp, it means the project's absolute root path; the sidecar consumes it as a filesystem directory.

## Acceptance Criteria

- [ ] Dashboard renders real data in IDEA and at least one non-IDEA IDE (PyCharm or GoLand)
- [ ] First-run failure states are designed panels, not blanks: Node missing / too old (detected vs. required version shown) / broken, JCEF unsupported (within 2s), no logs (directories listed), parse-in-progress (live counts within 2s)
- [ ] Configured Node path wins over PATH; Retry re-detects without IDE restart
- [ ] IDE kill leaves no orphaned Node process; crash → ≤3 restarts with backoff, then actionable error banner
- [ ] **Project scope round-trips:** a project-layer `saveRule` from a window writes under that project's root (the `projectRoot` stamp is the project's filesystem path, not an ID) and the rule loads back — verified end-to-end, since the part-2 stdio suite cannot (no project is attached there)
- [ ] **Trust channel routes:** the bridge demultiplexes the sidecar's `host-request` (`trust/get`/`trust/update`) and replies `host-response` (stubbed until part 5) without leaking those lines into the webview; the sidecar follow-up emits/consumes the channel and its mock-host test is green
- [ ] Lifecycle test suite and the static mock-bridge bundle harness green in CI

## Success Metrics

Warm start to interactive dashboard ≤ 5s against the part-2 fixture dataset.

## Dependencies

- **Part 1** (scaffold) and **Part 2** (working sidecar) must merge first.
- This part is **not purely Kotlin**: it includes a small `sidecar/src/rpc-server.ts` follow-up to wire the `host-request`/`host-response` trust channel (Part 2 shipped the `host-shims` primitives but left the server on the no-channel in-memory memento). Keep that change and its test in this PR so the Kotlin bridge and the sidecar channel land together.
- `DashboardBrowser.kt` (in the parent layout) is **folded into `CoachToolWindowFactory.kt`** for part 3 (the JCEF browser + gate live there); it is not a separate file unless the factory grows past readability.

## Dependencies & Risks

- Trusted Types under JCEF is the top unknown — spike early (timeboxed ≤1 day, see Tasks); fallback documented in the parent plan's risk table.
- macOS GUI PATH (version-manager users) is the most likely first-run failure — the cascade with **default-version resolution** (not a glob), not bare PATH lookup, is the primary path.

## References & Research

- Parent plan: `docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` (RPC relay design, Node sidecar lifecycle, D4/D7)
- Shim proof: `tests/e2e/harness.html:78-93` · client singleton: `src/webview/shared.ts:8-9`
- CSP reference: `src/webview/panel-html.ts:10-66`
- JCEF docs: https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html
- Threading: https://plugins.jetbrains.com/docs/intellij/threading-model.html

---

## Implementation Status (as of 2026-06-15)

**Branch:** `feat/jetbrains-part-3-kotlin-shell`
**PR:** https://github.com/patrek/jetbrains-ai-coach/pull/4

### What is done

All code was written and committed before debugging began. The plugin builds, loads in the Gradle `runIde` sandbox, JCEF opens, Node is detected, the sidecar starts, finds 147 sessions, and emits `dataReady`. All Kotlin tests pass (NodeDetectorTest ×8, SidecarSupervisorTest ×11). All 1154 sidecar tests pass.

The loading screen renders correctly — it steps through all 6 phases (Discovering → Checking cache → Parsing → Scanning → Preparing analytics → Ready) and reaches 100%. The sidebar icons are visible on the right edge (correct structure).

**The one remaining blocker: the dashboard does not render after Ready.**

After `dataReady` is received the loading screen stays on-screen permanently. `onDataReady()` should call `setShellLoadingMode(false)` + `navigateTo('dashboard')` → `renderPage('dashboard')` → `withErrorBoundary(…renderDashboard)`. This transition never happens.

### Bugs fixed during this session

| Commit | Fix |
|--------|-----|
| Initial commits | All 51 part-3 files committed; Kotlin + sidecar tests green |
| `extractBundle` fix | `protectionDomain.codeSource` is null in Gradle dev sandbox; switched to `getResource("/sidecar/main.js")` URL-based location (handles `jar://` prod and `file://` dev) |
| Trusted Types spike | `require-trusted-types-for 'script'` + `trusted-types coach-html default` removed from CSP in `index.html` and `test-harness.html` — JCEF's bundled Chromium silently blocks `innerHTML` under those directives |
| `57620dc` | Race condition: `dataReady` was sent before `warmUp` completed; warmUp's subsequent `progress` messages re-triggered `ensureLoadingUI()` which overwrote the dashboard. Fixed: `dataReady` now sent after `warmUp`. |
| `3be5121` | Stale bundle cache: `SidecarRuntime.ensureExtracted` reused the first-ever extracted `~/.ai-coach-jetbrains/runtime/0.1.0/` on every `runIde` because the version string never changes in dev. Fixed: when classpath is `file://` (dev sandbox), skip the `isComplete` short-circuit and always re-extract. Production (`jar://`) still uses the version-stamp cache. |

### Active investigation

Despite the two fixes above, the dashboard still does not render. Both fixes are confirmed present in `sidecar/dist/main.js` (verified via `loadData()` body in the bundle). The re-extraction fix means the bundle is now correct on each run.

**Most likely remaining hypotheses (in priority order):**

1. **`renderDashboard` throws inside `withErrorBoundary`** — `withErrorBoundary` catches the error and renders an error fallback in `#content`, but the `loading-mode` CSS class is still on `#app` (hiding the sidebar and filling the full width with the loading screen). So the error panel would be rendered but visually buried under or behind the loading overlay. The `setShellLoadingMode(false)` call in `onDataReady` would remove `loading-mode` *before* `navigateTo` is called — but if `#app` is somehow null (wrong `getElementById`), the class removal silently fails and the loading screen stays. Verify: add a `console.log` in `onDataReady` and inspect via JCEF DevTools (right-click → Inspect / open from IDE).

2. **`dataReady` message is not being received by the webview** — `deliver()` in `WebviewBridge.kt` uses `gson.toJson(message.toString())` which double-encodes: `gson.toJson` takes a string and returns a JSON string literal (with surrounding quotes and escape sequences). The resulting JS is: `window.dispatchEvent(new MessageEvent('message',{data:JSON.parse("\"{ ... }\"")}))` — `JSON.parse` of a JSON string literal returns a `string`, not an object. `ev.data` would then be a string, `msg.type` would be `undefined`, and `msg.type === 'dataReady'` would be `false`. **However**, `progress` messages go through the same `deliver()` path and they clearly DO work (the loading screen updates correctly). So either (a) the double-encoding is fine and `JSON.parse` of a string works here, or (b) there is something different about how `progress` vs `dataReady` is dispatched. Needs a concrete test.

3. **`onDataReady` fires but `renderDashboard` is an async function that throws before its first `await`** — `withErrorBoundary` wraps the sync throw but the async rejection path also calls `showErrorFallback`. If the error fallback renders correctly but is invisible because `loading-mode` is still active (see hypothesis 1), this would look identical.

### How to diagnose next

**Option A — JCEF DevTools console:**
After `runIde` loads the dashboard, right-click in the tool window and look for "Inspect" / "Developer Tools". If that's not available, add a temporary JS injection in `WebviewBridge.onConnected`:
```kotlin
browser.cefBrowser.executeJavaScript("""
  window.addEventListener('message', function(e) {
    console.log('[msg]', typeof e.data, JSON.stringify(e.data).slice(0, 200));
  });
""", "", 0)
```
This will show whether `dataReady` arrives and what shape `ev.data` has.

**Option B — Visual DOM probe:**
Add a temporary visible indicator in `onDataReady` in `app.ts`:
```typescript
function onDataReady(currentWorkspace: string): void {
  document.title = 'DATA READY';  // visible in IDE tab title
  // ... rest of function
```
If the title changes, `onDataReady` fired. If it doesn't, the message isn't reaching the handler.

**Option C — Fix the `deliver()` encoding directly:**
The `gson.toJson(message.toString())` double-encoding is suspicious regardless. A cleaner fix:
```kotlin
private fun deliver(message: JsonObject) {
    val js = "window.dispatchEvent(new MessageEvent('message',{data:${message}}));"
    runCatching { browser.cefBrowser.executeJavaScript(js, browser.cefBrowser.url, 0) }
        .onFailure { log.debug("deliver failed (browser disposed?)", it) }
}
```
`message.toString()` on a Gson `JsonObject` returns valid JSON, so it can be embedded directly as a JS object literal — no `JSON.parse` needed. This eliminates any double-encoding risk and is the cleanest path. Try this first.

### Relevant file locations

| File | Notes |
|------|-------|
| `plugin/src/main/kotlin/com/aicoach/jetbrains/jcef/WebviewBridge.kt` | `deliver()` at line 178 — suspect encoding; `onPush` at line 163 |
| `plugin/src/main/kotlin/com/aicoach/jetbrains/sidecar/SidecarRuntime.kt` | `ensureExtracted` — dev sandbox re-extraction fix at line 48 |
| `sidecar/src/rpc-server.ts` | `loadData()` — `dataReady` after `warmUp` fix at line 207 |
| `sidecar/vendor/webview/app.ts` | `onDataReady` at line 420; `setShellLoadingMode` at line 95; `renderPage` at line 621 |
| `sidecar/vendor/webview/shared.ts` | `initMessageListener` at line 53; `withErrorBoundary` at line 419; `setHtml`/`innerHTML` at line 164 |
| `plugin/src/main/resources/webview/index.html` | CSP — Trusted Types directives removed |
| `plugin/src/main/resources/webview/bootstrap.js` | `acquireVsCodeApi` shim; `postToHost` queue |

### Next session starting point

1. Try **Option C first** (fix `deliver()` encoding in `WebviewBridge.kt`) — it's a 2-line change and eliminates the most structural suspect.
2. If that doesn't work, add the console-log probe (Option A) to get ground truth on what `ev.data` looks like.
3. Once the dashboard renders, verify all acceptance criteria from this plan.
4. Merge PR #4 and begin Part 4 (theme integration).
