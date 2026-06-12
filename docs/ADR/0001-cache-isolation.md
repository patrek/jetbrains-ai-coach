# ADR 0001: Isolate the cache from the VS Code extension

- **Status:** Accepted
- **Date:** 2026-06-11
- **Decision ID:** D1

## Context

The upstream extension and this fork can both be installed for the same user,
parsing the same user-level log directories (`~/.claude`, `~/.codex`, …). The
tempting option is to share the on-disk parse cache so a dual-IDE user pays the
parse cost once.

But upstream's cache writes (`src/core/cache.ts`) are non-atomic, two-file,
fire-and-forget operations with no locking. Two facts make sharing unsafe:

- `CACHE_VERSION` drift between the fork and upstream would cause a mutual
  eviction loop — each side invalidates the other's cache on every IDE switch,
  forcing a full re-parse every time.
- The fork discovers a different (smaller) set of session sources than VS Code
  (no `workspaceStorage`, see [ADR 0008](0008-v1-log-sources.md)). The fork's
  save would overwrite the shared cache with fewer sources, making VS Code's
  workspace sessions appear to vanish.

## Decision

Use a **separate cache directory**: `~/.ai-coach-jetbrains/cache/`. The sidecar
overrides `CACHE_DIR` in `cache-paths.ts`. Additionally, the fork writes the
cache via **temp-file + rename** so a SIGKILL during shutdown can never tear a
half-written cache.

This revises the brainstorm's original shared-cache idea.

## Consequences

- Dual-IDE users pay one duplicate parse. Acceptable: parsing is fast and the
  cost is bounded.
- No cross-tool eviction loop; each host's cache is independent and stable.
- Atomic writes make the cache robust against the hard process kills used during
  IDE shutdown ([ADR 0004](0004-app-level-sidecar-singleton.md)).

## Alternatives considered

- **Shared cache directory** — rejected after inspecting `cache.ts`: the
  non-atomic writes, version drift, and source-set mismatch make it actively
  harmful, not merely suboptimal.
