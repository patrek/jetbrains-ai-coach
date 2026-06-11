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
- `jcef/AssetSchemeHandler.kt`: serves `/webview/*` from the plugin JAR under a custom scheme (decision D7 — `loadHTML` breaks relative script resolution). Serves `index.html` with a **CSP equivalent to upstream `panel-html.ts:10-66`** (script-src restricted to the scheme, no remote origins) and inlines `window.__INITIAL_STATE__` (read synchronously from `PropertiesComponent` at request time) plus initial theme CSS into `bootstrap.js`.
- `bootstrap.js`: defines `window.acquireVsCodeApi` before `app.js` loads (the `tests/e2e/harness.html:78-93` trick) — `postMessage` → JBCefJSQuery, `getState` → pre-seeded `__INITIAL_STATE__`, `setState` → in-page cache + async `persistState`.
- `jcef/WebviewBridge.kt`: JBCefJSQuery **created before browser initialization** (platform constraint); handlers off-EDT; queue-until-handshake with 10s connect timeout → error state; host-method interception (`openExternal` → `BrowserUtil.browse`, `saveModelBudgets`/`loadModelBudgets` → `PropertiesComponent`, `reviewLocalRules` → trust dialog stub until part 5, `getCapabilities` → `{llm:false, host:'jetbrains'}`); stamps each forwarded envelope with the owning window's project ID; broadcasts progress/dataReady to all open tool windows.
- `sidecar/NodeDetector.kt`: configured setting → PATH → well-known locations (`~/.nvm/versions/node/*/bin`, `~/.volta/bin`, fnm, `/opt/homebrew/bin`, `/usr/local/bin`, `%ProgramFiles%\nodejs`) → manual picker; validates `node --version` ≥ 20 with 5s hang guard; distinct "missing" / "too old" / "broken" panels with Retry (no IDE restart).
- `sidecar/SidecarService.kt` + `SidecarProcess.kt`: app-level `@Service` singleton (decision D4), coroutine-spawned `GeneralCommandLine` + `KillableProcessHandler`; crash → backoff restart (max 3) → error banner with "Restart sidecar" / "View logs" (`~/.ai-coach-jetbrains/logs/sidecar.log`); orphan prevention (stdin-close contract + stale-PID sweep); version-stamped runtime extraction with stable `runtime/current` entry point; shutdown flush (≤2s) before kill.
- `settings/CoachSettings.kt` + `CoachSettingsConfigurable.kt`: Node path override, log-dir overrides, "Clear analytics cache".

## Tasks

- [ ] `CoachToolWindowFactory.kt` + JCEF gate + Swing fallback panel
- [ ] `AssetSchemeHandler.kt` (CSP + state/theme inlining) + `index.html` + `bootstrap.js`
- [ ] Trusted Types spike: verify the bundle's policy under bundled JCEF Chromium; fallback patch only with the CSP verified present
- [ ] `WebviewBridge.kt` (creation order, threading, queue, interception, project-ID stamping, broadcast)
- [ ] `NodeDetector.kt` + the three failure panels with Retry
- [ ] `SidecarService.kt` / `SidecarProcess.kt` (supervisor, orphan handling, `runtime/current`, flush)
- [ ] `CoachSettings.kt` / Configurable
- [ ] Tests land with the code: `SidecarService` lifecycle tests (spawn / crash-restart / dispose / orphan sweep); Playwright harness (second static harness mirroring `bootstrap.js`, upstream `tests/e2e/harness.html` pattern) validating the served bundle against a mock bridge

## Technical Considerations

- JBCefJSQuery handlers run on a CEF I/O thread — never touch Swing there.
- `OSProcessHandler.waitFor()` on EDT is an error on 2026.1+ — all process work via coroutines/BGT.
- Empty state must list the directories checked per harness (port-specific copy — the upstream empty state references VS Code sources).

## Acceptance Criteria

- [ ] Dashboard renders real data in IDEA and at least one non-IDEA IDE (PyCharm or GoLand)
- [ ] First-run failure states are designed panels, not blanks: Node missing / too old (detected vs. required version shown) / broken, JCEF unsupported (within 2s), no logs (directories listed), parse-in-progress (live counts within 2s)
- [ ] Configured Node path wins over PATH; Retry re-detects without IDE restart
- [ ] IDE kill leaves no orphaned Node process; crash → ≤3 restarts with backoff, then actionable error banner
- [ ] Lifecycle test suite and Playwright bundle harness green in CI

## Success Metrics

Warm start to interactive dashboard ≤ 5s against the part-2 fixture dataset.

## Dependencies

- **Part 1** (scaffold) and **Part 2** (working sidecar) must merge first.

## Dependencies & Risks

- Trusted Types under JCEF is the top unknown — spike early; fallback documented in the parent plan's risk table.
- macOS GUI PATH (version-manager users) is the most likely first-run failure — the cascade, not bare PATH lookup, is the primary path.

## References & Research

- Parent plan: `docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` (RPC relay design, Node sidecar lifecycle, D4/D7)
- Shim proof: `tests/e2e/harness.html:78-93` · client singleton: `src/webview/shared.ts:8-9`
- CSP reference: `src/webview/panel-html.ts:10-66`
- JCEF docs: https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html
- Threading: https://plugins.jetbrains.com/docs/intellij/threading-model.html
