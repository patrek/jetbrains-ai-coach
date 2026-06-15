# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-06-12

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->

## Key Learnings

- **Project:** ai-coach-jetbrains
- **Description:** A JetBrains IDE plugin that analyzes your AI coding assistant usage across

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->

## Do-Not-Repeat (2026-06-15)
- **Sidecar main.js changes silently don't reach the IDE if runtime extraction is stale.** The sidecar bundle is extracted to `~/.ai-coach-jetbrains/runtime/<ver>/` and run from there; the webview `app.js` is served straight from the JAR by `AssetSchemeHandler`. So a webview change loads immediately but a `sidecar/` change only loads if `SidecarRuntime.ensureExtracted` actually re-extracts. The runIde sandbox jars the plugin (`jar://`), and the version dir name never changes in dev — so any version/`isComplete`/protocol-based reuse check strands the first extraction forever. Freshness MUST key on bundle content (SHA-256 fingerprint in `.bundle-hash`), not the version string or classpath protocol. When verifying a sidecar fix in the IDE, check `grep -c <symbol> ~/.ai-coach-jetbrains/runtime/*/main.js` — not just `sidecar/dist`.
- **Bumping the persisted Session/parse shape requires bumping `CACHE_VERSION`** (sidecar/vendor/core/cache.ts) or the IDE reuses a stale `~/.ai-coach-jetbrains/cache/parsed.json` that lacks the new field.

## Decision Log (part 4 — theme integration, 2026-06-15)
- **Webview state uses a single `aicoach.webviewState` blob key, NOT per-page `aicoach.webviewState.<page>`.** The part-4 plan mentioned `<page>` keys, but the part-3 `getState`/`setState` bootstrap shim (and upstream VS Code's state API) round-trips one whole-state object. Single key is correct; the plan wording was an over-specification. Do not "fix" it by splitting per page.
- **The webview persists ONLY learning/budgets/experiments/achievements via `getState`/`setState` — NEVER the current page or harness/workspace filter (verified in IDE 2026-06-15).** `setState` calls live in page-achievements (`achievementState`), page-burndown (`modelBudgets`), page-experiments (`experiments`/`activeLabTab`), page-learning-state (`learningState`). The active page + filters are module-level memory (`page-dashboard.ts` "Module-level view state"). So: page/filter survive tool-window hide/show (IntelliJ keeps the JS context alive, matching VS Code `retainContextWhenHidden`) but RESET on full IDE restart — this is correct upstream parity, NOT a bug. The plan's acceptance criterion "page/filter survives IDE restart" was wrong about what the webview persists. The Kotlin round-trip itself works (the getState blob is written to the project's `.idea/workspace.xml` under `PropertiesComponent` and read back via `WebviewBridge.currentState` → `__INITIAL_STATE__`). Don't try to "fix" restart page/filter loss without an explicit decision to add host-side state beyond upstream.
- **Theme switch = live `:root` set-property inject ONLY — NO reload (corrected 2026-06-15, see buglog bug-030).** The soft-reload approach (originally chosen to recolor charts) is BROKEN: the webview renders only after the sidecar's one-shot `dataReady` push, which fires once per sidecar *connection*. A soft reload restarts app.js on the same bridge/connection, so `dataReady` is never re-sent and the reloaded page hangs forever on "Building Activity Index". (A tool-window close/reopen makes a NEW connection → new handshake → new `dataReady` → works; only the in-place reload hangs.) Fix: live CSS-var injection recolors the whole CSS UI instantly with no reload. The bundled Chart.js `Chart` is module-local in vendored app.js (not on `window`, vendored files must not be patched), so mounted charts keep their palette until the tool window is reopened — accepted trade-off. **Never reintroduce a same-connection `reload()` in the webview without first re-triggering `dataReady`.**
- **`WebviewThemeSync` is deliberately untested.** It's a thin JCEF/EDT/message-bus class (one LafManagerListener subscription + two browser calls + a load gate), verified manually per plan tasks 3-5. Adding a browser-seam abstraction solely to unit-test 3 lines would violate the no-premature-abstraction rule. `ThemeCssProvider` (the pure logic) carries the unit tests instead.
- **`test-harness.html` shipping in the production JAR is a known deferral to part 7.** A ~25 KB upstream Playwright artifact is served at the webview origin (committed in part 3, wired in build.gradle.kts processResources/resources). Out of part-4 scope; part 7 (hardening/packaging/Marketplace) is where shipped-JAR test artifacts get stripped. Revisit then.

## Decision Log (part 5 — trust gate + project scoping, 2026-06-15)
- **The trust GATE was never enforced before part 5 — a real security gap, not just missing UI.** `sidecar/vendor/core/detector-registry.ts` calls `loadPersonalRules()` UNGATED at module import, and `setDefaultTrustGate`/`loadProjectRules` were never called anywhere. So personal rules executed without approval. Part 5's `sidecar/src/rule-scope.ts` `ruleScope.install()` (called in `rpc-server.start()` after `installTrustMemento`, before `loadData`) installs `createTrustGate(store)` and re-loads personal rules gated before any request is dispatched. Don't assume the sidecar enforces trust without this install step.
- **Approval is SIDECAR-DRIVEN, not Kotlin-driven (user-confirmed).** The dialog sends chosen filePaths; the sidecar's `approveLocalRules` calls vendored `approve(store, path, pendingEntry.content)` — hashing the AS-LOADED content, never a re-read. This is the TOCTOU guard and keeps `rule-trust.ts` authoritative (D5). The Kotlin `TrustStoreService` is a dumb generic key→JSON memento; it records NO hashes. Don't move hashing host-side.
- **Per-request project scoping = a promise-chain mutex in the sidecar (user-confirmed "serialized reload-on-change").** `RuleScope.run()` wraps EVERY dispatch; it reloads the project layer only when the request's effective root (projectRoot unless safeMode) differs from what's loaded. One shared sidecar serves all windows, so this prevents project A's rules executing on project B. Handlers run INSIDE `run` — they must call the free functions / `reloadCurrent` directly, NEVER `ruleScope.run` (would deadlock the chain).
- **`loadAllMetricLayers()` MUST NOT be called more than once.** It does `clearMetrics()` then guarded `registerAllBuiltinMetrics()`; the one-time guard means the 2nd call drops built-in metrics permanently. `rule-scope.ts` snapshots built-in metrics once and re-seeds them by hand on every reload (builtin→personal→project order). See buglog.
- **safe-mode hard-blocks the project layer.** The bridge stamps `safeMode = !project.isTrusted()` (`com.intellij.ide.impl.isTrusted` extension fun) on every forwarded envelope AND every `hostCall`; the sidecar drops the project layer entirely when safeMode. Untrusted IntelliJ projects load no project rules/metrics regardless of approval.
- **`LocalRuleWatcher` and `TrustGateController`'s JCEF/EDT/notification glue are deliberately untested** (same precedent as `WebviewThemeSync`, part 4). The pure logic is extracted and unit-tested instead: `parsePendingRules` (top-level fun in TrustGateController.kt → `TrustGateParsingTest`), `safeMode` stamping + `hostCall` routing/fail-fast (`SidecarSupervisorTest`), and the gate/scoping/TOCTOU behaviors (`sidecar/test/trust-gate.test.ts`). Don't add a JCEF seam abstraction just to unit-test the thin glue.
- **trust host-requests delegate to an injected `TrustStore` interface; `hostCall` is a new host-originated request path.** `SidecarSupervisor` stays IntelliJ-free: `TrustStore` (default `EmptyTrustStore`) is injected, real binding in `SidecarService` → `TrustStoreService`. `hostCall(method, params, projectRoot, safeMode, onResult)` lets the host (trust dialog) call sidecar methods and consume the response in Kotlin (separate `hostCalls` correlation map, prefix `k`); callbacks run on the supervisor stream thread → marshal to EDT.

## Decision Log (2026-06-15)
- **Skill Finder's two errors are accepted deferrals, NOT bugs — do not "fix" them.** `Error: llm-unavailable` (Custom Skill Opportunities) is the ADR 0006 degrade of `triageSkills` because the JetBrains host has `llm:false`. `Catalog error: Unknown method: discoverCatalog` (Community Skills) is the part-6 catalog port per ADR 0009 (`discoverCatalog`/`installSkill`/`installCatalogItem`). The page (`vendor/webview/page-skills.ts`) has no capability gating and surfaces both raw. User decided 2026-06-15 to leave as-is and defer graceful degradation + the catalog implementation to part 6. Revisit when an LLM-enabled host and the catalog port land.
