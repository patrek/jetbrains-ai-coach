---
title: "feat(jetbrains): repo scaffold and upstream sync pipeline (part 1/7)"
type: feat
date: 2026-06-11
parent: docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md
---

## feat(jetbrains): repo scaffold and upstream sync pipeline - Standard

## Overview

Create the new `ai-coach-jetbrains` repository (working name) and the vendoring pipeline that every later part builds on: IntelliJ plugin scaffold from the official template, the `tools/sync-upstream.mjs` script that pulls a pinned upstream SHA of `src/core` + `src/webview` into `sidecar/vendor/`, the patch mechanism for the small allowed divergence set, esbuild config for the sidecar bundles, licensing/attribution, and ADRs recording architecture decisions D1–D8 (see parent plan, "Settled architecture decisions").

## Problem Statement / Motivation

The port's whole premise is ~90% code reuse with lockstep upstream fixes. That only holds if vendoring is mechanical, CI-gated, and the divergence set stays small and auditable. This must exist before any vendored code is written (parent plan, decision D3).

## Proposed Solution

- Repo from `intellij-platform-plugin-template`; IntelliJ Platform Gradle Plugin 2.x; `<depends>com.intellij.modules.platform</depends>` only (runs in all JetBrains IDEs); `sinceBuild` ≥ 242.
- `tools/sync-upstream.mjs`: pin upstream SHA in a manifest, copy `src/core/**` (incl. `rules/*.md`, `metrics/*.metric.md`, colocated tests) and `src/webview/**` into `sidecar/vendor/`, apply `tools/patches/*`, run the vendored vitest suite, fail loudly on patch conflicts.
- esbuild config mirroring upstream `esbuild.mjs` worker handling: `sidecar/dist/{main.js, mcp-main.js, parse-worker.js, warm-up-worker.js, cache-write-worker.js}` (Node/CJS).
- MIT LICENSE + NOTICE with Microsoft attribution.
- `docs/ADR/0001`–`0008` for D1–D8 (cache isolation, stdio MCP, vendoring, app-level sidecar singleton, Kotlin-side trust store, `getCapabilities` degradation, custom scheme handler, v1 log sources).
- CI: Gradle build + `verifyPlugin`, sidecar vitest (vendored suite), sync-script dry run.

## Tasks

- [ ] Scaffold repo: `plugin/build.gradle.kts`, `plugin/src/main/resources/META-INF/plugin.xml`, Gradle version catalog, GitHub Actions CI
- [ ] `tools/sync-upstream.mjs` + `tools/upstream.lock` (pinned SHA) + `tools/patches/README.md` (divergence log, target < 10 patches)
- [ ] `sidecar/esbuild.mjs` producing the 5 bundles; `sidecar/package.json` with vitest wired to the vendored tests
- [ ] LICENSE (MIT) + NOTICE (Microsoft attribution); repo README stub
- [ ] `docs/ADR/0001-cache-isolation.md` … `0008-v1-log-sources.md`

## Technical Considerations

- The sync script must never require hand-editing vendored files; all divergence flows through `tools/patches/`.
- Patch conflicts on a new upstream SHA must fail CI, not silently skip.

## Acceptance Criteria

- [ ] From a clean clone, `node tools/sync-upstream.mjs` produces a populated `sidecar/vendor/` and a green vendored vitest run
- [ ] CI gates on: Gradle build, `verifyPlugin`, vendored tests, sync dry-run
- [ ] Plugin skeleton installs in IDEA and one non-IDEA IDE (no functionality yet)
- [ ] ADRs for D1–D8 merged; NOTICE attribution present

## Success Metrics

Re-syncing to a new upstream SHA takes < 1 hour including test verification; patch set < 10 files.

## Dependencies

None — this is the first PR of the series. All later parts (2–7) depend on it.

## Dependencies & Risks

- Upstream restructuring `src/core`/`src/webview` breaks the sync script — pinned-SHA syncs are deliberate; conflicts surface in CI.
- `intellijIdeaCommunity` Gradle DSL is unavailable for platform 2025.3+ (use `intellijIdea`).

## References & Research

- Parent plan: `docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` (D1–D8, repo layout)
- Upstream build reference: `esbuild.mjs:1-181`
- Template: https://github.com/JetBrains/intellij-platform-plugin-template
- Gradle plugin 2.x: https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html
