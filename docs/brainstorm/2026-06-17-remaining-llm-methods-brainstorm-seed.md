---
title: "Brainstorm seed: wire the remaining degraded LLM methods to the CLI provider"
type: brainstorm-seed
date: 2026-06-17
status: not started
predecessor: docs/brainstorm/2026-06-16-cli-provider-selection-brainstorm-doc.md
predecessor_plan: docs/plan/2026-06-16-feat-selectable-cli-provider-plan.md
---

> **Purpose.** This file seeds the *next* brainstorm. Read it cold, then run
> `/vgv-wingspan:brainstorm` (or `/brainstorm`). It captures where we left off,
> the reusable pattern, the candidate scope, and the open questions — so a fresh
> session needs no prior context.

## Where we are now

PR #14 (`feat/cli-provider-selection-host`) shipped the **selectable CLI inference
provider** — phases 3–5 of the cli-provider plan. PR #13 shipped the sidecar
provider layer (phases 1–2). Together they wired exactly **two** AI-backed
dashboard methods to a real backend (Claude Code / GitHub Copilot CLI):

- `generateRule` and `explainOccurrence` — verified end-to-end (Generate rule
  returns a real rule when Claude Code is selected, consented, and authed).

Everything else that needs a language model still **degrades** to
`errorResult('llm-unavailable')`. The provider infrastructure now exists, so
lighting up the rest is mostly per-method prompt shaping + gating + tests — the
hard architecture (detection, consent, per-RPC stamping, per-window capabilities,
webview gating) is already done and proven.

## What's left (the candidate backlog)

### A. Remaining degraded LLM methods — `LLM_UNAVAILABLE_METHODS` (10 entries)
Source of truth: `sidecar/src/rpc-handlers.ts` (the `LLM_UNAVAILABLE_METHODS`
set). Natural clusters:

| Cluster | Methods | Notes |
| --- | --- | --- |
| **Skill authoring** | `createSkill`, `generateSkillContent` | Small; reuse vendored prompts via export patch(es) |
| **Learning page** | `generateLearningQuiz`, `generateLearningResources`, `generateCodeComparison`, `generateDidYouKnow` | 4 methods, similar prompt shape; highest "dead button" payoff |
| **Catalog / triage** | `triageSkills`, `triageCatalog`, `reviewContextFiles` | Ranking/review prompts |
| **`compileNlRule`** | (special — descoped in PR #14) | LLM call is **private** inside `sidecar/vendor/core/rule-compiler.ts` (`compileLlm()`), not in a handler. Needs either an `OVERRIDES` re-impl with a flattened prompt, or an upstreamable injected-inference seam. Highest friction — plan separately. |

### B. Capability gap: GitHub token / SDLC data
`github` capability is hardwired `false` (ADR 0009; `WebviewBridge.kt` synthesizes
it). `getSdlcGitHubData` degrades because there is no JetBrains equivalent of
`vscode.authentication`. Plannable: a host GitHub-token mechanism (settings field
or IDE GitHub-account integration) to light up SDLC GitHub features.

### C. Smaller UX / infra (from the cli-provider plan's Future Considerations + PR #14 testing)
- **Host→webview capabilities push** — today the webview re-polls `getCapabilities`
  per AI action; a push would refresh the UI instantly on a settings change.
- **User-facing "Restart sidecar" action** — expose `SidecarService.requestRestart()`
  (no UI action exists today; it's the clean way to force a provider re-detect).
- **Surface `total_cost_usd`** — Claude returns it; add `costUsd` to `ProviderResult`
  (`sidecar/src/cli-provider.ts`) + a small dashboard widget.
- **Third provider** — slots in behind `CliProvider` + one `resolveProvider` case
  (e.g. Gemini / Codex CLI).

## Recommended starting scope

**The Learning-page cluster** (4 methods) or **Skill-authoring cluster** (2
methods). Rationale: they reuse the exact pattern PR #14 proved, are low-risk, and
turn the most dead buttons live per unit of effort. Save `compileNlRule` (vendor
patch) and the GitHub-token work (new auth surface) for dedicated later plans.

## The reusable pattern (how `generateRule` / `explainOccurrence` were wired)

Follow PR #13/#14 precedent. For each new method:

1. **Remove it** from `LLM_UNAVAILABLE_METHODS` in `sidecar/src/rpc-handlers.ts`.
2. **Add an `OVERRIDES` handler** that builds a single flat prompt and calls
   `runWithProvider(ctx, prompt)` (already exists in `rpc-handlers.ts`). On
   `ok:false` it returns `errorResult('llm-unavailable', { reason })`.
3. **Reuse upstream prompts** where they are importable: add a minimal `export`
   patch under `tools/patches/` (see `0008-export-generate-rule-helpers.patch`).
   Inline string-literal prompts must be **re-derived** in the override (they are
   not importable symbols). Keep patches small — budget is "<10 small patches"
   (`tools/patches/README.md`).
4. **Webview gating** lives in `sidecar/vendor/webview/shared.ts` (patch `0006`).
   Decide per method: does it gate on `capabilities.provider.status` (like the
   2 wired methods) or stay on the single `capabilities.llm` flag? PR #14 only
   moved the 2 wired methods to provider-status gating.
5. **Tests:** extend `sidecar/src/rpc-handlers.test.ts` (real shape on fake
   provider success; `llm-unavailable` + reason on failure; absent stamp degrades;
   the remaining degraded count assertion). Update the `LLM_UNAVAILABLE_METHODS`
   size assertion each time it shrinks.

## Gotchas the next session MUST know (hard-won this session)

- **`sidecar/vendor/` is gitignored.** Vendored files are regenerated by
  `tools/sync-upstream.mjs` (pristine copy + `tools/patches/*.patch`). The **patch
  files are the committed source of truth**, not the vendored files. To regenerate
  a patch: extract pristine from `tools/.upstream-cache` (`git -C
  tools/.upstream-cache show '<SHA>:src/...'` — use the literal SHA, the cache is
  offline), diff pristine→desired with `diff -u` + an explicit `diff --git a/… b/…`
  header (git `--no-index` invents `a/a/` prefixes and detects spurious renames),
  validate with `git apply --check`.
- **`buildSidecar` Gradle task** now declares inputs/outputs (fixed in PR #14). If
  the deployed sidecar ever seems stale, confirm `processResources` re-ran and the
  extracted `~/.ai-coach-jetbrains/runtime/<version>/main.js` matches the JAR.
- **RTK proxy truncates redirected output** — pipe `git show` through `cat`; use
  `cp` for real files; `cd` into other dirs triggers permission prompts (use
  `git -C` / absolute paths).
- **Testing locally:** `:plugin:runIde` launches a sandbox IDE (a display is
  available). Sandbox settings persist at
  `.intellijPlatform/sandbox/plugin/IU-2024.2.5/config/options/aiCoach.xml` —
  delete it to test a clean first-run. Detection caches only ACTIVE results, so a
  transient `claude auth status` failure self-heals.

## Open questions for the brainstorm

1. Which cluster first — Learning (4 methods, most payoff) or Skill-authoring
   (2 methods, smallest)? One PR per cluster, or per method?
2. For each method: are the upstream prompts importable symbols (export patch) or
   inline literals (re-derive)? Audit `sidecar/vendor/webview/panel-rpc.ts`.
3. Do these methods need provider-status gating in the webview, or is the single
   `llm` flag enough for their UX? (Patch `0006` growth is the sensitive part.)
4. Any of these methods need **multi-turn** behavior (like `generateRule`'s
   validate-and-retry loop), or is a single flat prompt sufficient?
5. Should `compileNlRule` and the GitHub-token capability each get their own
   separate plan, or are they out of scope for the foreseeable future?

## Key references

- Plan that established the pattern: `docs/plan/2026-06-16-feat-selectable-cli-provider-plan.md`
- ADR 0010 (selectable CLI provider), ADR 0009 (method disposition), ADR 0006 (LLM degradation)
- Sidecar provider contract: `sidecar/src/cli-provider.ts`, adapters in `sidecar/src/providers/`
- Handler wiring + `runWithProvider`: `sidecar/src/rpc-handlers.ts`
- Webview gating: `sidecar/vendor/webview/shared.ts` + `tools/patches/0006-webview-llm-capability-gate.patch`
- Host detection/settings/capabilities: `plugin/src/main/kotlin/com/aicoach/jetbrains/sidecar/CliProviderDetector.kt`, `.../settings/`, `.../jcef/WebviewBridge.kt`
