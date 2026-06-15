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
- **Theme switch = live `:root` set-property inject + state-preserving soft reload (user choice 2026-06-15).** The bundled Chart.js `Chart` is module-local in vendored app.js (not on `window`, and vendored files must not be patched), so injected JS cannot recolor mounted charts. Live var injection recolors the whole CSS UI instantly and smooths the transition; the soft reload re-inlines theme + `__INITIAL_STATE__` so charts remount with the new palette without losing page/filter state. The reload is intentional, not redundant.
- **`WebviewThemeSync` is deliberately untested.** It's a thin JCEF/EDT/message-bus class (one LafManagerListener subscription + two browser calls + a load gate), verified manually per plan tasks 3-5. Adding a browser-seam abstraction solely to unit-test 3 lines would violate the no-premature-abstraction rule. `ThemeCssProvider` (the pure logic) carries the unit tests instead.
- **`test-harness.html` shipping in the production JAR is a known deferral to part 7.** A ~25 KB upstream Playwright artifact is served at the webview origin (committed in part 3, wired in build.gradle.kts processResources/resources). Out of part-4 scope; part 7 (hardening/packaging/Marketplace) is where shipped-JAR test artifacts get stripped. Revisit then.

## Decision Log (2026-06-15)
- **Skill Finder's two errors are accepted deferrals, NOT bugs — do not "fix" them.** `Error: llm-unavailable` (Custom Skill Opportunities) is the ADR 0006 degrade of `triageSkills` because the JetBrains host has `llm:false`. `Catalog error: Unknown method: discoverCatalog` (Community Skills) is the part-6 catalog port per ADR 0009 (`discoverCatalog`/`installSkill`/`installCatalogItem`). The page (`vendor/webview/page-skills.ts`) has no capability gating and surfaces both raw. User decided 2026-06-15 to leave as-is and defer graceful degradation + the catalog implementation to part 6. Revisit when an LLM-enabled host and the catalog port land.
