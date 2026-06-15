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

## Decision Log (2026-06-15)
- **Skill Finder's two errors are accepted deferrals, NOT bugs — do not "fix" them.** `Error: llm-unavailable` (Custom Skill Opportunities) is the ADR 0006 degrade of `triageSkills` because the JetBrains host has `llm:false`. `Catalog error: Unknown method: discoverCatalog` (Community Skills) is the part-6 catalog port per ADR 0009 (`discoverCatalog`/`installSkill`/`installCatalogItem`). The page (`vendor/webview/page-skills.ts`) has no capability gating and surfaces both raw. User decided 2026-06-15 to leave as-is and defer graceful degradation + the catalog implementation to part 6. Revisit when an LLM-enabled host and the catalog port land.
