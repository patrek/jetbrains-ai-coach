# Vendor patches — the divergence log

Every file under `sidecar/vendor/` is a **verbatim** snapshot of the upstream
[AI Engineering Coach](https://github.com/microsoft/AI-Engineering-Coach) repo at
the SHA pinned in `tools/upstream.lock`. Vendored files are **never hand-edited**.
The only sanctioned way to diverge from upstream is a patch in this directory.

`tools/sync-upstream.mjs` applies every `*.patch` here (sorted by filename) after
copying the upstream tree, using `git apply --check` first. A patch that no
longer applies **fails the sync and CI** — drift surfaces immediately instead of
rotting silently.

## Why so strict

The port's entire premise is ~90% code reuse with lockstep upstream fixes. That
only holds if re-syncing to a new upstream SHA stays mechanical. A small,
auditable patch set keeps it that way.

**Target: fewer than 10 small patches.** A growing patch set is a signal that a
divergence should instead be pushed upstream (e.g. the `getCapabilities`
capability method — see `docs/ADR/0006-getcapabilities-degradation.md`) or moved
out of the vendored tree into the sidecar's own (non-vendored) code.

## Authoring a patch

1. Run a full sync so `sidecar/vendor/` matches upstream exactly.
2. Edit the vendored file to the desired state.
3. Generate the patch from the repo root, paths relative to the repo root:

   ```bash
   git diff -- sidecar/vendor/ > tools/patches/NNNN-short-description.patch
   ```

4. Restore the vendored tree (`node tools/sync-upstream.mjs --skip-tests`) and
   confirm the patch re-applies cleanly.
5. Add a row to the log below.

## Divergence log

| Patch | Introduced by | Purpose |
| ----- | ------------- | ------- |
| `0001-cache-dir-and-atomic-writes.patch` | part 2 | Cache dir → `~/.ai-coach-jetbrains/cache/` (overridable via `AI_COACH_CACHE_DIR`) so the fork never collides with the VS Code extension's shared cache (decision D1), and `saveCacheData` writes **synchronously** via temp-file + rename. The fork parses in a child process that `parser.ts` kills the instant it returns its result, so upstream's deferred worker-thread write would be lost before it lands; the synchronous atomic write persists the cache before the child exits, which is what makes warm starts work. |
| `0002-findlogsdirs-drop-vscode-xcode.patch` | part 2 | `findLogsDirs()` returns `[]` so only the CLI-harness collectors run (Claude Code, Codex, OpenCode, Copilot CLI); VS Code workspaceStorage and Xcode discovery are dropped from the path (decision D8). Updates the matching `parser-main.test.ts` case so the vendored suite stays green. |
| `0003-panel-shared-type-only-vscode.patch` | part 2 | Make `panel-shared.ts`'s `vscode` import type-only. It is used only for types, but a runtime `import * as vscode` would crash the sidecar at load (no `vscode` module outside the IDE). Lets the sidecar reuse the vendored RPC handler map. |
| `0006-webview-llm-capability-gate.patch` | part 6; grown by cli-provider + learning-provider | The one sanctioned webview divergence for capability gating (decision D6, ADR 0006). `shared.ts` learns host LLM availability via `getCapabilities`, gates the 12 LLM-dependent methods before they fire when `llm === false`, and translates the sidecar's `llm-unavailable` error into a friendly "ask Claude Code to do it directly" message — so every degraded LLM *generation* feature shows clear guidance instead of a hang or a raw error (and does not falsely imply an analytics MCP tool generates it). **cli-provider growth (deliberate, risk-flagged):** the six provider-backed methods (`generateRule`, `explainOccurrence`, `generateLearningQuiz`, `generateLearningResources`, `generateCodeComparison`, `generateDidYouKnow`) now gate on `capabilities.provider.status` instead of the single `llm` flag — each provider state (not-selected / not-consented / not-installed / unauthenticated) and runtime failure `reason` (timeout / cli-error / bad-output) renders a distinct, actionable message — and they re-poll `getCapabilities` per call so a settings change takes effect without a host→webview push. The other 6 methods keep the single-flag degraded UX. The Learning prompts, JSON repair, validators, and normalizers live in sidecar-owned `sidecar/src/learning-provider.ts`; upstream syncs touching `panel-request-service.ts` or `panel-llm.ts` can silently drift from that re-derived logic, so compare those files during upstream bumps. Upstreamable: a VS Code host answers `{llm:true}` (+ `provider.status:'active'`) and the gate is inert. See `docs/llm-degradation-audit.md` for the per-page hide-vs-disable decisions. |
| `0007-dir-exclusion-env.patch` | part 7 | `parser-harnesses.ts` filters the Claude/Codex/OpenCode discovery (`findClaudeDirs`/`findCodexDirs`/`findOpenCodeDirs`) through the host's `AI_COACH_EXCLUDED_DIRS` env var so excluded directories are **never read** — the privacy control behind the first-run data-access disclosure. The exclusion logic mirrors the sidecar's `src/dir-exclusion.ts` (which covers the sidecar-owned Copilot `findLogsDirs` seam); it is inlined here so the vendored tree imports nothing out of `vendor/`. Inert upstream: with the env var unset, discovery is unchanged. |
| `0008-export-generate-rule-helpers.patch` | cli-provider | Adds `export` to four module-private `panel-rpc.ts` symbols (`GENERATE_RULE_SYSTEM_PROMPT`, `cleanRuleMarkdown`, `validateRuleMarkdown`, `buildOccurrenceSessionSummary`) so the sidecar's `generateRule`/`explainOccurrence` provider overrides reuse the upstream prompt + validators instead of duplicating ~120 lines that would rot on every re-sync. Export-only — zero behavior change; inert upstream. The `explainOccurrence` system/user prompt **literals** are re-derived in the override (they are inline strings, not symbols), and `serializeRule` is already exported by `core/rule-parser`, so this is the single export patch the cli-provider feature needs. |
| `0009-learning-quiz-fresh-card-per-question.patch` | learning quiz bugfix | Fixes two same-family Learning quiz bugs from Preact reusing the quiz card's DOM nodes across questions, so imperative mutations from answering question N leak onto N+1: (1) the feedback panel (explanation + Next button), rendered as a separate Preact root into `#quiz-feedback` and shown imperatively, stayed visible — and its stale Next button re-rendered the *current* question ("Next does nothing", with a mismatched explanation); (2) the choice buttons stayed `disabled` with their correct/wrong classes, so the next question could not be answered (no answer → no Next button). Fix: add `key=${index}` to the quiz card in `renderQuiz` so each question mounts a **fresh card** (fresh, enabled choices + an empty feedback panel), eliminating all carry-over at the root. Regression-tested by `sidecar/src/quiz-next-advance.test.ts` (full 3-question walkthrough). Environment-independent upstream bug; fix is upstreamable. |
