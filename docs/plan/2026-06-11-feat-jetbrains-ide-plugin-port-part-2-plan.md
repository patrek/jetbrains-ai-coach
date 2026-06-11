---
title: "feat(jetbrains): Node sidecar — stdio RPC server wrapping vendored core (part 2/7)"
type: feat
date: 2026-06-11
parent: docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md
---

## feat(jetbrains): Node sidecar stdio RPC server - Standard

## Overview

Implement the TypeScript sidecar: an NDJSON-framed stdio RPC server speaking the upstream webview envelope (`{type:'request', id, method, params}` / `{type:'response', id, data}` plus pushed `{type:'progress'}` / `{type:'dataReady'}`), dispatching the core RPC methods to the vendored `Analyzer`, with the fork's cache isolation, trust-memento-over-RPC shim, and a per-method integration test suite drivable without any IDE.

## Problem Statement / Motivation

`src/core` has zero `vscode` imports and already runs in plain Node workers, but the RPC handler layer (`src/webview/panel-rpc.ts`) does not: it contains 5 inline `require('vscode')` calls (lines ~70, 787, 892, 947, 1043). The sidecar therefore **re-derives** the handler map rather than vendoring it. This part delivers the entire engine of the plugin, CLI-testable in isolation.

## Proposed Solution

- `sidecar/src/main.ts` + `rpc-server.ts`: NDJSON framing, `hello` handshake (version + capabilities), dispatch, progress/dataReady forwarding, per-request project-scope resolution from the envelope stamp added by the Kotlin bridge.
- `sidecar/src/rpc-handlers.ts`: the 52 non-LLM core methods as mostly 1:1 `Analyzer` getter calls (`src/core/analyzer.ts:182-254`); the 3 LLM core methods (`generateRule`, `compileNlRule`, `explainOccurrence`) return typed `{error:'llm-unavailable'}`. `getWorkspaceDeps` and `saveRule` use the per-request project scope instead of VS Code workspace-root lookups. `saveRule` keeps auto-approval for personal-layer writes (parity with `panel-rpc.ts:846-878`).
- `sidecar/src/cache-paths.ts`: cache dir → `~/.ai-coach-jetbrains/cache/` (decision D1), atomic temp-file + rename writes, corrupted cache → log + re-parse (never crash).
- `sidecar/src/host-shims.ts`: `TrustMemento` adapter calling `trust/get`–`trust/update` host methods over the same stdio channel.
- Patch (in `tools/patches/`): disable VS Code workspaceStorage + Xcode discovery in `findLogsDirs`; keep Claude Code / Codex / OpenCode / Copilot CLI collectors as-is; `FF_TOKEN_REPORTING_ENABLED` stays at upstream default.
- Workers unchanged: `parse-worker` via `child_process.fork`, `warm-up-worker` via `worker_threads` (zero patches to `parser.ts:626-744` / `analyzer.ts:124-180`).

## Tasks

- [ ] `rpc-server.ts`: framing, handshake, dispatch, push-message forwarding, per-request scope
- [ ] `rpc-handlers.ts`: re-derived 52-method map + 3 LLM degradations; project-scope replacements for `getWorkspaceDeps`/`saveRule`
- [ ] Audit + finalize the disposition of the 9 "audit" extension methods (`getSdlcGitHubData`, `triageSkills`, `triageCatalog`, `installSkill`, `installCatalogItem`, `discoverCatalog`, `reviewContextFiles`, `getWorkspaceDeps`, SDLC methods) — port vs. degrade each
- [ ] `cache-paths.ts`: new dir, atomic writes, corruption recovery
- [ ] `host-shims.ts`: trust-memento-over-RPC + `saveRule` auto-approval
- [ ] `findLogsDirs` patch (drop workspaceStorage/Xcode); feature-flag disposition documented
- [ ] Committed fixture dataset (~500 synthetic sessions / ~50 MB) for perf and integration tests
- [ ] Stdio integration tests, one per method, generated mechanically from the typed `RpcMethodMap`: shape-valid response per ported method, typed error per degraded method, progress + dataReady on a parse run

## Technical Considerations

- No `vscode` call may survive into the sidecar — enforced by the per-method test suite running in plain Node.
- The sidecar exits when stdin closes (orphan prevention contract with part 3).

## Acceptance Criteria

- [ ] Sidecar parses real local logs driven from a CLI test script (no IDE)
- [ ] Per-method stdio suite green: 52 ported core methods answer, 3 LLM core methods degrade with the typed error
- [ ] Corrupted/truncated cache files log and re-parse, never crash; cache writes are atomic
- [ ] Vendored core test suite still green after the `findLogsDirs` patch

## Success Metrics

Warm start (valid cache) answers `getStats` in ≤ 5s against the committed fixture dataset.

## Dependencies

- **Part 1** must merge first (vendored core, esbuild, patch mechanism).

## Dependencies & Risks

- The 9-method audit may move methods from "port" to "degrade" — acceptable; the disposition table in the parent plan is the source of truth and is updated by this PR.
- `panel-rpc.ts` helper functions may be partially reusable — extract only what has no `vscode` reachability.

## References & Research

- Parent plan: `docs/plan/2026-06-11-feat-jetbrains-ide-plugin-port-plan.md` (RPC relay design, disposition table, D1/D5)
- Envelope + methods: `src/core/types/rpc-types.ts:57-148` · LLM set: `src/webview/shared.ts:15`
- Handlers to re-derive: `src/webview/panel-rpc.ts` (inline `require('vscode')` at ~70, 787, 892, 947, 1043)
- Workers: `src/core/parse-worker.ts`, `src/core/warm-up-worker.ts`, `src/core/cache-write-worker.ts`
- Cache: `src/core/cache.ts:91,95` · Trust: `src/core/rule-trust.ts:31-34`
