---
title: "feat(jetbrains): theme integration and webview state persistence (part 4/7)"
type: feat
date: 2026-06-11
parent: docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md
---

## feat(jetbrains): theme integration and webview state persistence - Standard

## Overview

Complete the visual and state integration: map all 23 theme variables (21 CSS-layer `--vscode-*` variables plus `--vscode-panel-border` and `--vscode-font-family` read at Chart.js mount) to IntelliJ theme sources, inject them before first render and live on theme change, and finish the `getState`/`setState` round-trip so dashboard page/filter state survives tool-window hide/show and IDE restart.

## Problem Statement / Motivation

The webview's theming is pure CSS variables with fallbacks; without host injection every theme renders the dark-default fallback palette. State persistence parity matters because upstream users keep page/filter context across panel hide/show — losing it is a silent UX regression.

## Proposed Solution

- `theme/ThemeCssProvider.kt`: derive values via `UIManager` / `JBColor` / `EditorColorsManager` per the parent plan's mapping table; serialize to `:root` custom properties.
- Initial paint: variables inlined into the scheme-handler-served `index.html` (no white flash); JCEF component background set to `Panel.background`.
- Live switch: `LafManagerListener.TOPIC` → re-derive → `executeJavaScript` setting properties on `:root`, **without page reload**. Chart.js reads some values at mount (`src/webview/shared.ts:90-110`) — if recolor doesn't take, fall back to a soft reload that preserves state via the `getState` shim.
- State: verify the part-3 `__INITIAL_STATE__` inlining + async `persistState` round-trip through `PropertiesComponent` end-to-end (keys `aicoach.webviewState.<page>`), including IDE restart.

## Tasks

- [ ] `ThemeCssProvider.kt` with the full 23-variable mapping (parent plan table is the starting point; finalize against real IDE values)
- [ ] Pre-first-render injection + JCEF component background
- [ ] `LafManagerListener` live re-injection; Chart.js recolor test with the burndown page open; state-preserving soft-reload fallback
- [ ] End-to-end state persistence verification (hide/show + IDE restart)
- [ ] Visual pass: light, dark, high-contrast, and one third-party theme (Material) across every nav-registry page

## Technical Considerations

- High-contrast and custom themes must degrade to the existing CSS fallbacks, never to unreadable combinations.
- Theme-change events arrive on the EDT; `executeJavaScript` must happen after page load (`onLoadEnd`).

## Acceptance Criteria

- [ ] No white flash on tool-window open in a dark theme
- [ ] Light↔dark switch updates the open dashboard live — including charts — without losing page/filter state
- [ ] Dashboard page/filter state survives tool-window hide/show and IDE restart
- [ ] All 23 variables injected (audited against `tests/e2e/harness.html` + `shared.ts:107-108`)

## Success Metrics

Visual pass sign-off across 4 themes × every nav-registry page with zero unreadable combinations.

## Dependencies

- **Part 3** must merge first (JCEF browser, scheme handler, bridge). Independent of part 5.

## Dependencies & Risks

- Chart.js recolor is the known risk; the fallback (state-preserving soft reload) is designed in, not improvised.

## References & Research

- Parent plan: `docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` (theme mapping table)
- Variable list: `tests/e2e/harness.html` (21 vars) · Chart.js reads: `src/webview/shared.ts:90-110`
- CSS fallbacks: `src/webview/styles.css:8-37`
- Theme colors: https://plugins.jetbrains.com/docs/intellij/platform-theme-colors.html
